/* Sync merge + key derivation — run with: npm run test
   These guard the two ways cross-device sync goes wrong: silently losing an
   edit made on the other laptop, and resurrecting something the user deleted. */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  mergeRecords, mergeTombstones, pruneTombstones, mergeMemory,
  mergeHistory, mergeSettings, mergePayloads,
} from './src/shared/merge.ts';
import { deriveKeyMaterial, encryptJSON, decryptJSON, randomSalt } from './src/shared/crypto.ts';

const card = (id, at, extra = {}) => ({ id, updatedAt: at, ...extra });

/* ─── 1. Neither laptop loses its own work ─── */
{
  const laptop = [card('a', 100), card('shared', 500, { nick: 'laptop' })];
  const desktop = [card('b', 200), card('shared', 400, { nick: 'desktop' })];
  const merged = mergeRecords(laptop, desktop);

  assert.equal(merged.length, 3, 'records unique to one device must survive');
  assert.ok(merged.find((c) => c.id === 'a'), 'laptop-only record kept');
  assert.ok(merged.find((c) => c.id === 'b'), 'desktop-only record kept');
  assert.equal(merged.find((c) => c.id === 'shared').nick, 'laptop', 'newer edit wins');
}

/* ─── 2. Merging is order-independent ───
   Both machines run the same merge; if the result depended on argument order
   they would push conflicting "winners" at each other forever. */
{
  const a = [card('x', 1), card('y', 9)];
  const b = [card('y', 5), card('z', 3)];
  const ids = (list) => list.map((r) => `${r.id}@${r.updatedAt}`).sort().join(',');
  assert.equal(ids(mergeRecords(a, b)), ids(mergeRecords(b, a)));
}

/* ─── 3. Merging twice changes nothing ─── */
{
  const a = [card('x', 1)];
  const b = [card('x', 2), card('y', 3)];
  const once = mergeRecords(a, b);
  const twice = mergeRecords(once, b);
  assert.deepEqual(
    once.map((r) => r.id).sort(),
    twice.map((r) => r.id).sort(),
  );
}

/* ─── 4. A delete stays deleted ───
   Without tombstones the other device's stale copy walks the record back in. */
{
  const stillThere = [card('gone', 100)];
  const tombstones = { gone: 200 };
  assert.equal(mergeRecords([], stillThere, tombstones).length, 0, 'deleted record must not resurrect');
}

/* ─── 5. …unless it was edited after the delete ─── */
{
  const editedLater = [card('gone', 300)];
  const tombstones = { gone: 200 };
  assert.equal(mergeRecords([], editedLater, tombstones).length, 1, 'a later edit overrides the delete');
}

/* ─── 6. Tombstones union, keeping the later time, and expire ─── */
{
  assert.deepEqual(mergeTombstones({ a: 1 }, { a: 5, b: 2 }), { a: 5, b: 2 });
  const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
  const pruned = pruneTombstones({ ancient: old, fresh: Date.now() });
  assert.deepEqual(Object.keys(pruned), ['fresh']);
}

/* ─── 7. Memory keys on (domain, question), and hit counts accumulate ─── */
{
  const mine = [{ key: 'first name', domain: '', value: 'Kay', hits: 3, updatedAt: 10 }];
  const theirs = [
    { key: 'first name', domain: '', value: 'Kay', hits: 7, updatedAt: 5 },
    { key: 'first name', domain: 'acme.com', value: 'K.', hits: 1, updatedAt: 8 },
  ];
  const merged = mergeMemory(mine, theirs);
  assert.equal(merged.length, 2, 'global and site-scoped facts are different records');
  const global = merged.find((f) => f.domain === '');
  assert.equal(global.value, 'Kay');
  assert.equal(global.hits, 7, 'confidence earned on the other device counts here too');
}

/* ─── 8. History unions and stays bounded ─── */
{
  const mine = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, timestamp: i }));
  const theirs = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, timestamp: i + 1000 }));
  const merged = mergeHistory(mine, theirs, 100);
  assert.equal(merged.length, 100, 'capped');
  assert.ok(merged[0].timestamp > merged[99].timestamp, 'newest first');
  assert.ok(merged.some((h) => h.id.startsWith('t')), 'other device entries present');
}

/* ─── 9. An API key added on one laptop is not erased by the other ─── */
{
  const mine = { updatedAt: 100, autoDetect: true, providers: { openai: { apiKey: 'sk-mine', model: 'gpt-4o' } } };
  const theirs = { updatedAt: 200, autoDetect: false, providers: { groq: { apiKey: 'gsk-theirs', model: 'llama' } } };
  const merged = mergeSettings(mine, theirs);
  assert.equal(merged.autoDetect, false, 'newer settings object wins overall');
  assert.equal(merged.providers.openai.apiKey, 'sk-mine', 'the other device’s key survives');
  assert.equal(merged.providers.groq.apiKey, 'gsk-theirs');
}

/* An empty key must never overwrite a real one. */
{
  const withKey = { updatedAt: 100, providers: { openai: { apiKey: 'sk-real', model: 'gpt-4o' } } };
  const blank = { updatedAt: 200, providers: { openai: { apiKey: '', model: 'gpt-4o' } } };
  assert.equal(mergeSettings(withKey, blank).providers.openai.apiKey, 'sk-real');
}

/* ─── 10. Whole-payload merge: the two-laptop scenario end to end ─── */
{
  const laptop = {
    profiles: [card('p1', 100, { name: 'Personal' })],
    paymentCards: [card('c1', 100)],
    passwords: [],
    memory: [{ key: 'email', domain: '', value: 'a@b.com', hits: 1, updatedAt: 100 }],
    history: [{ id: 'h1', timestamp: 100 }],
    settings: { updatedAt: 100, providers: {} },
    tombstones: {},
  };
  const desktop = {
    profiles: [card('p1', 50, { name: 'old' }), card('p2', 90, { name: 'Work' })],
    paymentCards: [],
    passwords: [card('w1', 80)],
    memory: [{ key: 'phone', domain: '', value: '555', hits: 2, updatedAt: 90 }],
    history: [{ id: 'h2', timestamp: 90 }],
    settings: { updatedAt: 90, providers: {} },
    tombstones: {},
  };

  const merged = mergePayloads(laptop, desktop);
  assert.equal(merged.profiles.length, 2, 'both profiles survive');
  assert.equal(merged.profiles.find((p) => p.id === 'p1').name, 'Personal', 'newer profile wins');
  assert.equal(merged.paymentCards.length, 1, 'card added on the laptop survives');
  assert.equal(merged.passwords.length, 1, 'password added on the desktop survives');
  assert.equal(merged.memory.length, 2, 'both learned facts survive');
  assert.equal(merged.history.length, 2);
}

/* ─── 11. Key derivation: same secret + salt ⇒ same keys on any machine ───
   This is the whole basis of "sign in on your second laptop and it just works". */
{
  const salt = randomSalt();
  const a = await deriveKeyMaterial('correct horse battery staple', salt);
  const b = await deriveKeyMaterial('correct horse battery staple', salt);
  assert.equal(a.authHash, b.authHash, 'the server must recognise the same password');
  assert.equal(a.encryptionKey, b.encryptionKey, 'the second laptop must derive the same key');

  const wrong = await deriveKeyMaterial('correct horse battery stapl', salt);
  assert.notEqual(wrong.authHash, a.authHash);
  assert.notEqual(wrong.encryptionKey, a.encryptionKey);

  // The value sent to the server must not be the key that opens the data.
  assert.notEqual(a.authHash, a.encryptionKey, 'auth proof and encryption key must be distinct');

  // A different salt means a different key, so two accounts sharing a password
  // do not share a key.
  const other = await deriveKeyMaterial('correct horse battery staple', randomSalt());
  assert.notEqual(other.encryptionKey, a.encryptionKey);
}

/* ─── 12. Round trip, and the wrong key fails closed ─── */
{
  const salt = randomSalt();
  const { encryptionKey } = await deriveKeyMaterial('a-very-long-passphrase', salt);
  const secret = { rawKey: encryptionKey };

  const payload = { paymentCards: [{ id: 'c1', cardNumber: '4111111111111111' }] };
  const blob = await encryptJSON(payload, secret);

  // The ciphertext must not contain the plaintext anywhere.
  assert.ok(!JSON.stringify(blob).includes('4111111111111111'), 'card number must not appear in the blob');

  assert.deepEqual(await decryptJSON(blob, secret), payload);

  const { encryptionKey: wrongKey } = await deriveKeyMaterial('a-different-passphrase', salt);
  await assert.rejects(() => decryptJSON(blob, { rawKey: wrongKey }), /Could not decrypt/);

  // Tampering must fail too — AES-GCM authenticates, it does not just scramble.
  const tampered = { ...blob, ct: blob.ct.slice(0, -4) + 'AAAA' };
  await assert.rejects(() => decryptJSON(tampered, secret), /Could not decrypt/);
}

console.log('✅ sync merge + crypto OK');

/* ─── 13. A settled sync must be a no-op ───
   Sync writes to storage, and storage writes schedule a sync. If a run where
   nothing changed still reported changes, the two would trigger each other
   forever. This is the assertion that keeps that loop closed. */
{
  const { fingerprint } = await import('./src/shared/merge.ts');
  const settled = {
    profiles: [card('p1', 100)],
    paymentCards: [], passwords: [],
    memory: [{ key: 'email', domain: '', value: 'a@b.com', hits: 1, updatedAt: 100 }],
    history: [{ id: 'h1', timestamp: 100 }],
    settings: { updatedAt: 100, providers: {} },
    tombstones: {},
  };
  const merged = mergePayloads(settled, settled);
  assert.equal(fingerprint(merged), fingerprint(settled),
    'merging a payload with itself must change nothing, or sync loops forever');

  // Key order must not affect the fingerprint — a collected snapshot and a
  // merged one build their objects in different orders.
  const reordered = {
    tombstones: {}, settings: { providers: {}, updatedAt: 100 },
    history: [{ timestamp: 100, id: 'h1' }],
    memory: [{ updatedAt: 100, hits: 1, value: 'a@b.com', domain: '', key: 'email' }],
    passwords: [], paymentCards: [], profiles: [{ updatedAt: 100, id: 'p1' }],
  };
  assert.equal(fingerprint(reordered), fingerprint(settled), 'fingerprint must ignore key order');
}

console.log('✅ sync is idempotent');
