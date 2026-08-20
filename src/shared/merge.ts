/* ─────────────────────────────────────────────────
   FormPilot — sync merge.

   Two laptops both edit offline. Whole-blob last-writer-wins would throw one
   laptop's afternoon away, so every collection is merged record by record:

     • same record on both sides  → the newer `updatedAt` wins
     • record on one side only    → kept, unless a tombstone says it was deleted
     • deleted on one side        → stays deleted, unless the other side edited
                                     it *after* the delete

   Tombstones are what make deletion survive a round trip. Without them, a card
   deleted on the laptop resurrects from the desktop's copy on the next sync.
   ───────────────────────────────────────────────── */

export interface Tombstones { [id: string]: number }   // record id → deletedAt

export interface MergeableRecord {
  id: string;
  updatedAt?: number;
  createdAt?: number;
}

// Some records (history entries, memory facts) key on something other than id.
type KeyFn<T> = (item: T) => string;
type TimeFn<T> = (item: T) => number;

const defaultKey = (item: any) => String(item?.id ?? '');
const defaultTime = (item: any) => Number(item?.updatedAt ?? item?.createdAt ?? item?.timestamp ?? 0);

/**
 * Merges two lists of records. Order of arguments does not matter — the result
 * is the same either way, which is what keeps two devices from ping-ponging
 * different "winners" back and forth forever.
 */
export function mergeRecords<T>(
  mine: T[] = [],
  theirs: T[] = [],
  tombstones: Tombstones = {},
  key: KeyFn<T> = defaultKey,
  time: TimeFn<T> = defaultTime,
): T[] {
  const winners = new Map<string, T>();

  for (const item of [...mine, ...theirs]) {
    const id = key(item);
    if (!id) continue;

    const deletedAt = tombstones[id];
    // An edit that happened after the delete means the user changed their mind
    // on the other device; the edit wins. Otherwise the delete stands.
    if (deletedAt !== undefined && time(item) <= deletedAt) continue;

    const existing = winners.get(id);
    if (!existing || time(item) > time(existing)) winners.set(id, item);
  }

  return Array.from(winners.values());
}

/** Union of both sides' tombstones, keeping the later delete time. */
export function mergeTombstones(mine: Tombstones = {}, theirs: Tombstones = {}): Tombstones {
  const merged: Tombstones = { ...mine };
  for (const [id, at] of Object.entries(theirs)) {
    if (!merged[id] || at > merged[id]) merged[id] = at;
  }
  return merged;
}

/**
 * Tombstones are pure overhead once every device has seen them. Drop the ones
 * older than the cutoff so the payload does not grow forever.
 * ponytail: time-based expiry, not vector clocks. A device offline for longer
 * than `maxAgeMs` can resurrect a deleted record — acceptable at 90 days.
 */
export function pruneTombstones(tombstones: Tombstones = {}, maxAgeMs = 90 * 24 * 60 * 60 * 1000): Tombstones {
  const cutoff = Date.now() - maxAgeMs;
  return Object.fromEntries(Object.entries(tombstones).filter(([, at]) => at > cutoff));
}

/* ─── Per-collection merges ─── */

export const memoryKeyOf = (fact: any) => `${fact?.domain ?? ''}::${fact?.key ?? ''}`;

/** Memory facts key on (domain, question), and `hits` accumulates across devices. */
export function mergeMemory(mine: any[] = [], theirs: any[] = [], tombstones: Tombstones = {}): any[] {
  const merged = mergeRecords(mine, theirs, tombstones, memoryKeyOf);

  // Confidence earned on the desktop should count on the laptop too, so take
  // the larger hit count rather than the winner's.
  const hitsByKey = new Map<string, number>();
  for (const fact of [...mine, ...theirs]) {
    const id = memoryKeyOf(fact);
    hitsByKey.set(id, Math.max(hitsByKey.get(id) ?? 0, Number(fact?.hits ?? 0)));
  }
  return merged.map((fact) => ({ ...fact, hits: hitsByKey.get(memoryKeyOf(fact)) ?? fact.hits }));
}

/** History is append-only: union by id, newest first, bounded. */
export function mergeHistory(mine: any[] = [], theirs: any[] = [], limit = 100): any[] {
  return mergeRecords(mine, theirs, {}, defaultKey, (h: any) => Number(h?.timestamp ?? 0))
    .sort((a: any, b: any) => Number(b?.timestamp ?? 0) - Number(a?.timestamp ?? 0))
    .slice(0, limit);
}

/**
 * Settings are one small object, so the whole thing is last-writer-wins —
 * except the provider table, where each provider's API key is merged
 * individually. Losing the key you added on the other laptop because you
 * toggled a checkbox here would be maddening.
 */
export function mergeSettings(mine: any, theirs: any): any {
  const mineAt = Number(mine?.updatedAt ?? 0);
  const theirsAt = Number(theirs?.updatedAt ?? 0);
  const winner = theirsAt > mineAt ? theirs : mine;
  const loser = theirsAt > mineAt ? mine : theirs;
  if (!winner) return loser ?? {};

  const providers = { ...(loser?.providers ?? {}) };
  for (const [id, config] of Object.entries<any>(winner?.providers ?? {})) {
    // An empty key never overwrites a real one.
    providers[id] = {
      ...(providers[id] ?? {}),
      ...config,
      apiKey: config?.apiKey || providers[id]?.apiKey || '',
    };
  }
  return { ...winner, providers };
}

/* ─── Whole payload ─── */

export interface SyncPayload {
  profiles?: any[];
  settings?: any;
  history?: any[];
  paymentCards?: any[];
  passwords?: any[];
  memory?: any[];
  tombstones?: Tombstones;
  updatedAt?: number;
}

/* A content hash of a payload, stable regardless of key or record order.
   Sync compares fingerprints to answer "did anything actually change?" — the
   answer is no on the vast majority of runs, and acting on that is what keeps
   an automatic sync from writing (and therefore re-triggering) itself. */
export function fingerprint(payload: SyncPayload): string {
  const list = (items: any[] = [], key: (i: any) => string) =>
    items.map((i) => `${key(i)}:${stable(i)}`).sort().join('|');

  return [
    list(payload.profiles, defaultKey),
    list(payload.paymentCards, defaultKey),
    list(payload.passwords, defaultKey),
    list(payload.memory, memoryKeyOf),
    list(payload.history, defaultKey),
    stable(payload.settings ?? {}),
    stable(payload.tombstones ?? {}),
  ].join('#');
}

// JSON.stringify preserves insertion order, which differs between a freshly
// collected snapshot and a merged one. Sorting keys makes the two comparable.
function stable(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

/** Merges a local snapshot with the server's copy. Commutative and idempotent. */
export function mergePayloads(mine: SyncPayload, theirs: SyncPayload): SyncPayload {
  const tombstones = pruneTombstones(mergeTombstones(mine.tombstones, theirs.tombstones));

  return {
    profiles: mergeRecords(mine.profiles, theirs.profiles, tombstones),
    paymentCards: mergeRecords(mine.paymentCards, theirs.paymentCards, tombstones),
    passwords: mergeRecords(mine.passwords, theirs.passwords, tombstones),
    memory: mergeMemory(mine.memory, theirs.memory, tombstones),
    history: mergeHistory(mine.history, theirs.history),
    settings: mergeSettings(mine.settings, theirs.settings),
    tombstones,
    updatedAt: Math.max(Number(mine.updatedAt ?? 0), Number(theirs.updatedAt ?? 0)),
  };
}
