/* ─────────────────────────────────────────────────
   FormPilot — account & session handling.

   Three ways in, one resulting session:
     • Google         — OAuth id token, no password to remember
     • Email + password — one secret that both signs you in and unlocks your data
     • Email + code   — a 6-digit code, no password at all

   Whichever route you take, the key that decrypts your data is derived on this
   device and never sent anywhere. See crypto.ts for why.
   ───────────────────────────────────────────────── */

import type { AuthState } from './types';
import { GOOGLE_CLIENT_ID, SYNC_API_URL, SYNC_CONFIGURED } from './config';
import { deriveKeyMaterial } from './crypto';
import { getItem, setItem, removeItem } from './storage.ts';
import { STORAGE_KEYS } from './constants.ts';

/* ─── The unlock key ───
   Held in chrome.storage.session: memory-only, wiped when the browser closes,
   and unreadable by web pages. It has to live somewhere the background worker
   can reach, or automatic sync would need the passphrase retyped every time
   Chrome recycles the service worker. Disk is the one place it must not go. */
const SESSION_KEY = 'formpilot_unlock_key';

async function sessionArea(): Promise<chrome.storage.StorageArea | null> {
  return typeof chrome !== 'undefined' && chrome.storage?.session ? chrome.storage.session : null;
}

export async function setUnlockKey(rawKey: string): Promise<void> {
  const area = await sessionArea();
  if (area) await area.set({ [SESSION_KEY]: rawKey });
}

export async function getUnlockKey(): Promise<string | null> {
  const area = await sessionArea();
  if (!area) return null;
  const result = await area.get(SESSION_KEY);
  return result?.[SESSION_KEY] ?? null;
}

export async function clearUnlockKey(): Promise<void> {
  const area = await sessionArea();
  if (area) await area.remove(SESSION_KEY);
}

/* ─── Stored account state ───
   Everything here is safe on disk: an email, a session token, and a public
   salt. None of it can decrypt anything. */
export async function getAuthState(): Promise<AuthState | null> {
  return getItem<AuthState>(STORAGE_KEYS.AUTH);
}

async function patchAuthState(patch: Partial<AuthState>): Promise<AuthState> {
  const current = (await getAuthState()) ?? ({} as AuthState);
  const next = { ...current, ...patch } as AuthState;
  await setItem(STORAGE_KEYS.AUTH, next);
  return next;
}

export async function clearAuthState(): Promise<void> {
  await removeItem(STORAGE_KEYS.AUTH);
  await clearUnlockKey();
}

/* ─── HTTP ─── */

function assertConfigured() {
  if (!SYNC_CONFIGURED) {
    throw new Error('Sync is not set up. Fill in SYNC_API_URL (and GOOGLE_CLIENT_ID for Google sign-in) in src/shared/config.ts — see docs/sync-setup.md.');
  }
}

async function api(path: string, init: RequestInit = {}, token?: string): Promise<any> {
  assertConfigured();
  let response: Response;
  try {
    response = await fetch(`${SYNC_API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // fetch only rejects on a transport failure, which for a user means one
    // thing: the network or the server is down.
    throw new Error('Could not reach the sync server. Check your connection.');
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error(body?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

/** Authenticated request using the stored session, refreshing Google tokens as needed. */
export async function authedApi(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getAccessToken();
  try {
    return await api(path, init, token);
  } catch (err: any) {
    // A dead session on a Google account can be revived silently; a dead
    // password/OTP session genuinely needs the user back.
    if (err?.status === 401) {
      const state = await getAuthState();
      if (state?.method === 'google') {
        const fresh = await googleIdToken(false).catch(() => null);
        if (fresh) return api(path, init, fresh);
      }
      await patchAuthState({ sessionToken: '', expiresAt: 0 });
      throw new Error('Your session expired. Sign in again.');
    }
    throw err;
  }
}

async function getAccessToken(): Promise<string> {
  const state = await getAuthState();
  if (!state) throw new Error('Sign in to sync your data.');

  if (state.method === 'google') {
    // Google id tokens last an hour; fetch a fresh one rather than tracking it.
    return googleIdToken(false).catch(() => googleIdToken(true));
  }

  if (!state.sessionToken || state.expiresAt < Date.now()) {
    throw new Error('Your session expired. Sign in again.');
  }
  return state.sessionToken;
}

/* ─── Google ─── */

let cachedGoogle: { token: string; expiresAt: number } | null = null;

async function googleIdToken(interactive: boolean): Promise<string> {
  assertConfigured();
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not configured. Set GOOGLE_CLIENT_ID in src/shared/config.ts.');
  if (cachedGoogle && cachedGoogle.expiresAt > Date.now() + 60_000) return cachedGoogle.token;

  const redirectUri = chrome.identity.getRedirectURL();
  // Implicit id_token flow: no client secret, so nothing secret ships inside the
  // extension bundle. The nonce ties the response to this specific request.
  const nonce = crypto.randomUUID();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    '&response_type=id_token' +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent('openid email')}` +
    `&nonce=${nonce}` +
    `&prompt=${interactive ? 'select_account' : 'none'}`;

  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive });
  } catch (err: any) {
    const message = String(err?.message || err);
    // A non-interactive attempt failing is normal and expected — it just means
    // Google needs the user to click something. Say so instead of alarming them.
    if (!interactive) throw new Error('Silent sign-in unavailable.');
    if (/user did not approve|canceled|closed/i.test(message)) throw new Error('Sign-in was cancelled.');
    if (/redirect_uri|invalid/i.test(message)) {
      throw new Error(`Google rejected the redirect URI. Add ${chrome.identity.getRedirectURL()} to your OAuth client's authorised redirect URIs.`);
    }
    throw new Error(`Google sign-in failed: ${message}`);
  }
  if (!redirect) throw new Error('Sign-in was cancelled.');

  const params = new URLSearchParams(new URL(redirect).hash.slice(1));
  const token = params.get('id_token');
  if (!token) {
    const reason = params.get('error');
    if (reason === 'interaction_required' || reason === 'login_required' || reason === 'consent_required') {
      throw new Error('Silent sign-in unavailable.');
    }
    throw new Error(reason ? `Google returned: ${reason}` : 'Google did not return an id token.');
  }

  const claims = decodeJwt(token);
  if (claims.nonce !== nonce) throw new Error('Sign-in response did not match this request. Try again.');
  if (claims.aud !== GOOGLE_CLIENT_ID) throw new Error('Sign-in response was for a different app.');

  cachedGoogle = { token, expiresAt: Number(claims.exp) * 1000 };
  return token;
}

function decodeJwt(token: string): any {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Malformed sign-in token.');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
}

/** Google sign-in. Returns the account, which still needs unlocking. */
export async function signInWithGoogle(): Promise<AuthState> {
  const token = await googleIdToken(true);
  const claims = decodeJwt(token);
  const me = await api('/me', { method: 'GET' }, token);
  return patchAuthState({
    method: 'google',
    email: me.email || claims.email || '',
    userId: me.userId,
    kdfSalt: me.kdfSalt,
    verified: true,
    sessionToken: '',
    expiresAt: 0,
  });
}

/* ─── Email + password ───
   The password does double duty: it proves who you are to the server *and*
   derives the key that opens your data. That is why signing in on a second
   laptop needs nothing but the password. */

export const MIN_PASSWORD = 10;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (/^\d+$/.test(password)) return 'Digits alone are too easy to guess. Add letters.';
  if (/^(password|formpilot|qwerty|letmein)/i.test(password)) return 'That is one of the first passwords anyone tries.';
  return null;
}

/* The salt this email's keys are derived from. For an address with no account
   the server returns a stable stand-in, so this call reveals nothing about who
   is registered — and that stand-in becomes the real salt on registration. */
async function fetchSalt(email: string): Promise<string> {
  const result = await api('/auth/salt', { method: 'POST', body: JSON.stringify({ email }) });
  if (typeof result?.kdfSalt !== 'string' || !result.kdfSalt) {
    throw new Error('The sync server returned an unexpected response.');
  }
  return result.kdfSalt;
}

/** Creates the account and triggers the verification email. */
export async function registerWithPassword(email: string, password: string): Promise<{ email: string; devCode?: string }> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  // Always derive against the salt the server names. For an address that
  // already exists — a Google account adding a password, say — that is the
  // original salt, so data encrypted earlier stays readable.
  const kdfSalt = await fetchSalt(email);
  const { authHash } = await deriveKeyMaterial(password, kdfSalt);

  const result = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, authHash, kdfSalt }),
  });

  // Remembered so the verification screen survives the popup being closed.
  await patchAuthState({
    method: 'password', email: result.email ?? email, kdfSalt,
    verified: false, sessionToken: '', expiresAt: 0, userId: '',
  });
  return { email: result.email ?? email, devCode: result.devCode };
}

/** Confirms the emailed code, completing sign-up and unlocking in one step. */
export async function verifyEmail(email: string, code: string, password?: string): Promise<AuthState> {
  const result = await api('/auth/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  const state = await patchAuthState({
    method: 'password',
    email: result.email ?? email,
    userId: result.userId,
    kdfSalt: result.kdfSalt,
    verified: true,
    sessionToken: result.token,
    expiresAt: result.expiresAt,
  });
  if (password) await unlockWithSecret(password, result.kdfSalt);
  return state;
}

export async function resendVerification(email: string): Promise<{ devCode?: string }> {
  return api('/auth/resend', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function signInWithPassword(email: string, password: string): Promise<AuthState> {
  const kdfSalt = await fetchSalt(email);
  const { authHash } = await deriveKeyMaterial(password, kdfSalt);

  let result: any;
  try {
    result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, authHash }) });
  } catch (err: any) {
    // The server just re-sent a verification code; carry the user straight to
    // the code screen rather than making them start over.
    if (err?.status === 403 && err?.body?.status === 'verification_sent') {
      await patchAuthState({ method: 'password', email, kdfSalt, verified: false, sessionToken: '', expiresAt: 0, userId: '' });
      const needsVerify: any = new Error(err.message);
      needsVerify.needsVerification = true;
      throw needsVerify;
    }
    throw err;
  }

  const state = await patchAuthState({
    method: 'password',
    email: result.email ?? email,
    userId: result.userId,
    kdfSalt: result.kdfSalt ?? kdfSalt,
    verified: true,
    sessionToken: result.token,
    expiresAt: result.expiresAt,
  });
  await unlockWithSecret(password, result.kdfSalt ?? kdfSalt);
  return state;
}

/* ─── Email + code ───
   No password anywhere, so there is no password to derive a key from. These
   accounts set a separate unlock passphrase once; the code proves identity,
   the passphrase opens the data. */

export async function requestLoginCode(email: string): Promise<{ devCode?: string }> {
  // The server ignores this salt if the account already has one.
  const kdfSalt = await fetchSalt(email);
  const result = await api('/auth/otp/request', {
    method: 'POST',
    body: JSON.stringify({ email, kdfSalt }),
  });
  return { devCode: result.devCode };
}

export async function signInWithCode(email: string, code: string): Promise<AuthState> {
  const result = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) });
  return patchAuthState({
    method: 'otp',
    email: result.email ?? email,
    userId: result.userId,
    kdfSalt: result.kdfSalt,
    verified: true,
    sessionToken: result.token,
    expiresAt: result.expiresAt,
  });
}

/* ─── Unlocking ─── */

/** Derives and caches this session's encryption key. */
export async function unlockWithSecret(secret: string, kdfSalt?: string): Promise<void> {
  const state = await getAuthState();
  const salt = kdfSalt ?? state?.kdfSalt;
  if (!salt) throw new Error('Sign in before unlocking.');
  const { encryptionKey } = await deriveKeyMaterial(secret, salt);
  await setUnlockKey(encryptionKey);
}

export async function isUnlocked(): Promise<boolean> {
  return Boolean(await getUnlockKey());
}

/* ─── Session lifecycle ─── */

export async function signOut(): Promise<void> {
  const state = await getAuthState();
  // Best effort: the local session is cleared either way, so a failed call here
  // must not leave the user stuck signed in.
  if (state?.sessionToken) await authedApi('/logout', { method: 'POST' }).catch(() => {});
  cachedGoogle = null;
  await clearAuthState();
}

/** Invalidates every session on every device. For a lost or stolen laptop. */
export async function signOutEverywhere(): Promise<void> {
  await authedApi('/logout-all', { method: 'POST' });
  cachedGoogle = null;
  await clearAuthState();
}

export async function deleteAccount(): Promise<void> {
  await authedApi('/account', { method: 'DELETE' });
  cachedGoogle = null;
  await clearAuthState();
}

export async function refreshIdentity(): Promise<AuthState | null> {
  const state = await getAuthState();
  if (!state) return null;
  const me = await authedApi('/me', { method: 'GET' });
  return patchAuthState({
    email: me.email,
    userId: me.userId,
    kdfSalt: me.kdfSalt,
    verified: me.verified,
    devices: me.devices,
    hasPassword: me.hasPassword,
    hasGoogle: me.hasGoogle,
  });
}
