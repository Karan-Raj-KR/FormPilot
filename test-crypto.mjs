/* Encryption round-trip check — run with: node test-crypto.mjs
   Guards the sync path: data must survive encrypt→decrypt intact, a wrong
   passphrase must fail loudly rather than returning garbage, and two
   encryptions of the same data must never reuse a salt or nonce. */
import assert from 'node:assert/strict';
import { encryptJSON, decryptJSON } from './src/shared/crypto.ts';

const payload = {
  profiles: [{ id: 'personal', data: { firstName: 'Karan', rawInfo: 'x'.repeat(5000) } }],
  passwords: [{ domain: 'example.com', password: 'hunter2' }],
};

const blob = await encryptJSON(payload, 'correct horse battery staple');
assert.equal(blob.v, 1);
assert.ok(blob.ct.length > 0);
assert.ok(!JSON.stringify(blob).includes('hunter2'), 'plaintext leaked into the blob');

assert.deepEqual(await decryptJSON(blob, 'correct horse battery staple'), payload);

await assert.rejects(
  () => decryptJSON(blob, 'wrong passphrase here'),
  /Wrong passphrase/,
  'a wrong passphrase must throw, not return garbage',
);

// Reusing a nonce under one key breaks AES-GCM outright.
const second = await encryptJSON(payload, 'correct horse battery staple');
assert.notEqual(blob.iv, second.iv, 'IV was reused');
assert.notEqual(blob.salt, second.salt, 'salt was reused');
assert.notEqual(blob.ct, second.ct);

console.log('✅ encryption round-trip OK');
