/* ─────────────────────────────────────────────────
   FormPilot — cross-device sync.

   What actually travels: one AES-256-GCM ciphertext. The server holds it and
   an email address, and can read neither the profiles, the cards, the
   passwords, nor the memory inside it.

   Sync is automatic. Local edits mark the store dirty; a debounced push and a
   periodic pull (both driven from the background worker) keep two laptops
   level without anyone pressing a button.
   ───────────────────────────────────────────────── */

import type { SyncState } from './types';
import { encryptJSON, decryptJSON, type EncryptedBlob } from './crypto';
import { STORAGE_KEYS } from './constants.ts';
import { authedApi, getAuthState, getUnlockKey } from './auth.ts';
import { mergePayloads, pruneTombstones, fingerprint, type SyncPayload, type Tombstones } from './merge.ts';
import {
  getProfiles, saveProfiles, getSettings, saveSettings,
  getHistory, saveHistory, getPaymentCards, savePaymentCards,
  getPasswords, savePasswords, getItem, setItem, setItemQuietly, markDirty, recordDeletion,
} from './storage.ts';
import { getMemory, saveMemory } from './memory.ts';

export type { SyncPayload };

/* ─── Tombstones ───
   Written by storage.ts on every delete, so the deletion survives a round trip
   instead of the record reappearing from the other device. */
export async function getTombstones(): Promise<Tombstones> {
  return pruneTombstones((await getItem<Tombstones>(STORAGE_KEYS.TOMBSTONES)) ?? {});
}

export { markDirty, recordDeletion };

/* ─── Sync state ─── */
export async function getSyncState(): Promise<SyncState | null> {
  return getItem<SyncState>(STORAGE_KEYS.SYNC_STATE);
}

async function patchSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const current = (await getSyncState()) ?? { email: '', userId: '', lastSyncedAt: 0, remoteUpdatedAt: 0 };
  const next = { ...current, ...patch };
  await setItem(STORAGE_KEYS.SYNC_STATE, next);
  return next;
}

/* ─── Snapshot ─── */
async function collect(): Promise<SyncPayload> {
  const [profiles, settings, history, paymentCards, passwords, memory, tombstones] = await Promise.all([
    getProfiles(), getSettings(), getHistory(), getPaymentCards(), getPasswords(), getMemory(), getTombstones(),
  ]);
  return { profiles, settings, history, paymentCards, passwords, memory, tombstones };
}

/* Writes the merged result locally. Uses the quiet write path throughout:
   applying what sync just computed is not a local edit, and counting it as one
   would mark the store dirty and schedule another sync, forever. */
async function apply(payload: SyncPayload): Promise<void> {
  const writes: Array<[string, unknown]> = [];
  // Each key is guarded: a payload written by an older version simply has no
  // entry for that collection, and writing undefined over it would wipe the
  // data this sync exists to protect.
  if (payload.profiles) writes.push([STORAGE_KEYS.PROFILES, payload.profiles]);
  if (payload.settings) writes.push([STORAGE_KEYS.SETTINGS, payload.settings]);
  if (payload.history) writes.push([STORAGE_KEYS.HISTORY, payload.history]);
  if (payload.paymentCards) writes.push([STORAGE_KEYS.PAYMENT_CARDS, payload.paymentCards]);
  if (payload.passwords) writes.push([STORAGE_KEYS.PASSWORDS, payload.passwords]);
  if (payload.memory) writes.push([STORAGE_KEYS.MEMORY, payload.memory]);
  if (payload.tombstones) writes.push([STORAGE_KEYS.TOMBSTONES, payload.tombstones]);

  await Promise.all(writes.map(([key, value]) => setItemQuietly(key, value)));
}

/* ─── Transport ─── */

async function unlockKeyOrThrow(): Promise<{ rawKey: string }> {
  const rawKey = await getUnlockKey();
  if (!rawKey) throw new Error('Locked — enter your passphrase to sync.');
  return { rawKey };
}

/** Fetches and decrypts the server copy. Null when nothing is stored yet. */
async function fetchRemote(): Promise<{ payload: SyncPayload; updatedAt: number } | null> {
  const key = await unlockKeyOrThrow();
  let result: any;
  try {
    result = await authedApi('/sync', { method: 'GET' });
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
  if (!result?.blob) return null;
  const payload = await decryptJSON<SyncPayload>(result.blob as EncryptedBlob, key);
  return { payload, updatedAt: result.updatedAt };
}

async function putRemote(payload: SyncPayload, baseUpdatedAt: number): Promise<number> {
  const key = await unlockKeyOrThrow();
  const blob = await encryptJSON(payload, key);
  const result = await authedApi('/sync', { method: 'PUT', body: JSON.stringify({ blob, baseUpdatedAt }) });
  return result.updatedAt;
}

/* Whether the server already holds a copy. Needed before the unlock screen can
   decide whether the passphrase being typed is being *set* (and so must be
   confirmed — a typo would be unrecoverable) or merely *checked*. */
export async function remoteBackupExists(): Promise<boolean> {
  try {
    const result = await authedApi('/sync', { method: 'GET' });
    return Boolean(result?.blob);
  } catch (err: any) {
    if (err?.status === 404) return false;
    throw err;
  }
}

/* ─── The one operation that matters ───
   Pull, merge, write locally, push the merged result. Safe to call at any time
   from any device: merging is commutative, so two laptops running this
   concurrently converge instead of clobbering each other. */
export async function syncNow(): Promise<{ state: SyncState; changed: boolean }> {
  const state = await getSyncState();
  const remote = await fetchRemote();
  const local = await collect();
  const email = (await getAuthState())?.email ?? state?.email ?? '';

  if (!remote) {
    // Nothing on the server yet — this device seeds it.
    const updatedAt = await putRemote(local, 0);
    return {
      state: await patchSyncState({ email, lastSyncedAt: Date.now(), remoteUpdatedAt: updatedAt, pendingSince: undefined, lastError: undefined }),
      changed: true,
    };
  }

  const merged = mergePayloads(local, remote.payload);
  const mergedPrint = fingerprint(merged);

  // Only touch local storage if the merge actually produced something new.
  const localChanged = mergedPrint !== fingerprint(local);
  if (localChanged) await apply(merged);

  // Likewise, only upload if the server's copy is not already this.
  let updatedAt = remote.updatedAt;
  const remoteChanged = mergedPrint !== fingerprint(remote.payload);
  if (remoteChanged) {
    try {
      updatedAt = await putRemote(merged, remote.updatedAt);
    } catch (err: any) {
      // Another device wrote between our GET and our PUT. Its data is already
      // safe on the server; merge against the newer copy and retry once.
      if (err?.status !== 409) throw err;
      const newer = await fetchRemote();
      if (!newer) throw err;
      const remerged = mergePayloads(merged, newer.payload);
      if (fingerprint(remerged) !== fingerprint(local)) await apply(remerged);
      updatedAt = await putRemote(remerged, newer.updatedAt);
    }
  }

  return {
    state: await patchSyncState({
      email,
      lastSyncedAt: Date.now(),
      remoteUpdatedAt: updatedAt,
      pendingSince: undefined,
      lastError: undefined,
    }),
    changed: localChanged || remoteChanged,
  };
}

/* ─── Automatic sync ───
   Called from the background worker on a timer and after local edits settle.
   Every failure mode here is expected at some point — offline, locked, signed
   out — so none of them throw; they record a reason and wait for the next tick. */
let inFlight: Promise<any> | null = null;

export async function autoSync(): Promise<'synced' | 'skipped' | 'failed'> {
  // One at a time. Two concurrent syncs would each merge against a stale
  // snapshot and fight over the result.
  if (inFlight) {
    await inFlight.catch(() => {});
    return 'skipped';
  }

  const auth = await getAuthState();
  if (!auth?.verified) return 'skipped';
  if (!(await getUnlockKey())) return 'skipped';

  inFlight = syncNow();
  try {
    await inFlight;
    return 'synced';
  } catch (err: any) {
    await patchSyncState({ lastError: err?.message || 'Sync failed.' });
    return 'failed';
  } finally {
    inFlight = null;
  }
}

/* ─── Manual escape hatches ───
   Kept for the cases merging cannot decide: "this device is right, throw the
   other copy away", and the reverse. */

export async function forcePush(): Promise<SyncState> {
  const local = await collect();
  const remote = await fetchRemote();
  const updatedAt = await putRemote(local, remote?.updatedAt ?? 0);
  return patchSyncState({ lastSyncedAt: Date.now(), remoteUpdatedAt: updatedAt, pendingSince: undefined, lastError: undefined });
}

export async function forcePull(): Promise<SyncState | null> {
  const remote = await fetchRemote();
  if (!remote) return null;
  await apply(remote.payload);
  return patchSyncState({ lastSyncedAt: Date.now(), remoteUpdatedAt: remote.updatedAt, pendingSince: undefined, lastError: undefined });
}

export async function deleteRemote(): Promise<void> {
  await authedApi('/sync', { method: 'DELETE' });
  await patchSyncState({ remoteUpdatedAt: 0, lastSyncedAt: 0 });
}
