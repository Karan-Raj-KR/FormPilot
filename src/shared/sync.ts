/* ─────────────────────────────────────────────────
   FormPilot — cross-device sync.
   Google sign-in via launchWebAuthFlow (works in any browser that
   supports the identity API, not just Chrome), payload encrypted
   locally, stored as opaque ciphertext by the Worker.
   ───────────────────────────────────────────────── */

import type { SyncState } from './types';
import { GOOGLE_CLIENT_ID, SYNC_API_URL, SYNC_CONFIGURED } from './config';
import { encryptJSON, decryptJSON, type EncryptedBlob } from './crypto';
import { STORAGE_KEYS } from './constants';
import {
  getProfiles, saveProfiles, getSettings, saveSettings,
  getHistory, saveHistory, getPaymentCards, savePaymentCards,
  getPasswords, savePasswords, getItem, setItem, removeItem,
} from './storage';
import { getMemory, saveMemory } from './memory';

export interface SyncPayload {
  profiles: unknown;
  settings: unknown;
  history: unknown;
  paymentCards: unknown;
  passwords: unknown;
  memory?: unknown;
}

// The id token is short-lived (1h) and re-fetched on demand; it is never persisted.
let cachedToken: { token: string; expiresAt: number } | null = null;

function assertConfigured() {
  if (!SYNC_CONFIGURED) {
    throw new Error('Sync is not configured. Set GOOGLE_CLIENT_ID and SYNC_API_URL in src/shared/config.ts — see docs/sync-setup.md.');
  }
}

/** Interactive Google sign-in. Returns a fresh OIDC id token. */
async function getIdToken(interactive: boolean): Promise<string> {
  assertConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const redirectUri = chrome.identity.getRedirectURL();
  // Implicit id_token flow: no client secret, so nothing secret ships in the
  // extension bundle. The nonce ties the returned token to this request.
  const nonce = crypto.randomUUID();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&response_type=id_token` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent('openid email')}` +
    `&nonce=${nonce}` +
    `&prompt=${interactive ? 'select_account' : 'none'}`;

  const redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive });
  if (!redirect) throw new Error('Sign-in was cancelled.');

  // Implicit flow returns the token in the URL fragment.
  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const token = params.get('id_token');
  if (!token) throw new Error(params.get('error') || 'Google did not return an id token.');

  const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (claims.nonce !== nonce) throw new Error('Sign-in response did not match this request.');
  cachedToken = { token, expiresAt: claims.exp * 1000 };
  return token;
}

async function api(method: string, body?: unknown): Promise<any> {
  const token = await getIdToken(false).catch(() => getIdToken(true));
  const res = await fetch(`${SYNC_API_URL}/sync`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    cachedToken = null;
    throw new Error('Session expired — sign in again.');
  }
  if (res.status === 409) {
    throw new Error('This device is out of date: another device synced more recently. Pull first, then push.');
  }
  if (!res.ok && res.status !== 404) {
    throw new Error((await res.json().catch(() => ({}))).error || `Sync failed (${res.status}).`);
  }
  return res.status === 404 ? null : res.json();
}

// ─── Account state ───
export async function getSyncState(): Promise<SyncState | null> {
  return getItem<SyncState>(STORAGE_KEYS.SYNC_STATE);
}

async function setSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const current = (await getSyncState()) ?? { email: '', userId: '', lastSyncedAt: 0, remoteUpdatedAt: 0 };
  const next = { ...current, ...patch };
  await setItem(STORAGE_KEYS.SYNC_STATE, next);
  return next;
}

export async function signIn(): Promise<SyncState> {
  const token = await getIdToken(true);
  const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  return setSyncState({ email: claims.email || '', userId: claims.sub });
}

export async function signOut(): Promise<void> {
  cachedToken = null;
  await removeItem(STORAGE_KEYS.SYNC_STATE);
}

// ─── Push / pull ───
async function collect(): Promise<SyncPayload> {
  const [profiles, settings, history, paymentCards, passwords, memory] = await Promise.all([
    getProfiles(), getSettings(), getHistory(), getPaymentCards(), getPasswords(), getMemory(),
  ]);
  return { profiles, settings, history, paymentCards, passwords, memory };
}

async function apply(payload: SyncPayload): Promise<void> {
  await Promise.all([
    saveProfiles(payload.profiles as any),
    saveSettings(payload.settings as any),
    saveHistory(payload.history as any),
    savePaymentCards(payload.paymentCards as any),
    savePasswords(payload.passwords as any),
    // Absent from payloads written by v1.0 — leave local memory alone rather
    // than wiping it with an undefined.
    payload.memory ? saveMemory(payload.memory as any) : Promise.resolve(),
  ]);
}

/** Encrypt everything on this device and upload it. */
export async function push(passphrase: string): Promise<SyncState> {
  const state = await getSyncState();
  const blob = await encryptJSON(await collect(), passphrase);
  const result = await api('PUT', { blob, baseUpdatedAt: state?.remoteUpdatedAt ?? 0 });
  return setSyncState({ lastSyncedAt: Date.now(), remoteUpdatedAt: result.updatedAt });
}

/** Download and decrypt, replacing local data. Returns null if nothing is stored yet. */
export async function pull(passphrase: string): Promise<SyncState | null> {
  const result = await api('GET');
  if (!result) return null;
  const payload = await decryptJSON<SyncPayload>(result.blob as EncryptedBlob, passphrase);
  await apply(payload);
  return setSyncState({ lastSyncedAt: Date.now(), remoteUpdatedAt: result.updatedAt });
}

/** Pull if the server is ahead of us, otherwise push. */
export async function sync(passphrase: string): Promise<{ state: SyncState; action: 'pushed' | 'pulled' }> {
  const state = await getSyncState();
  const remote = await api('GET');
  if (remote && remote.updatedAt > (state?.remoteUpdatedAt ?? 0)) {
    return { state: (await pull(passphrase))!, action: 'pulled' };
  }
  return { state: await push(passphrase), action: 'pushed' };
}

/** Remove the encrypted copy from the server. Local data is untouched. */
export async function deleteRemote(): Promise<void> {
  await api('DELETE');
  await setSyncState({ remoteUpdatedAt: 0, lastSyncedAt: 0 });
}
