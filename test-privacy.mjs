/* Leak guards — run with: node test-privacy.mjs
   Each assertion here corresponds to a way user data could leave the device.
   If one of these fails, something private is about to be exposed. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inferCategory, isSensitiveField, SENSITIVE_VALUE } from './src/shared/constants.ts';
import { isLearnable, memoryForPrompt, memoryKey } from './src/shared/memory.ts';

/* ─── 1. Sensitive fields are recognised whatever the page calls them ─── */
const cases = [
  [{ type: 'password', label: 'Pick a password', name: 'pw' }, true],
  [{ type: 'text', autocomplete: 'cc-number', label: 'Number', name: 'n' }, true],
  [{ type: 'text', autocomplete: 'one-time-code', label: 'Code', name: 'c' }, true],
  [{ type: 'text', autocomplete: 'current-password', label: 'Secret', name: 's' }, true],
  [{ type: 'text', label: 'Card number', name: 'cardnumber' }, true],
  [{ type: 'text', label: 'CVV', name: 'cvv' }, true],
  [{ type: 'text', label: 'Verification code', name: 'code' }, true],
  [{ type: 'text', label: 'Account number', name: 'acct' }, true],
  [{ type: 'email', label: 'Email', name: 'email', category: 'contact' }, false],
  [{ type: 'text', label: 'City', name: 'city', category: 'address' }, false],
];
for (const [field, expected] of cases) {
  const category = field.category ?? inferCategory(field.label, field.type, field.name, field.autocomplete);
  assert.equal(isSensitiveField({ ...field, category }), expected,
    `isSensitiveField(${field.label}) should be ${expected}`);
}

/* ─── 2. Secret-shaped values never become memory ─── */
const plain = { category: 'contact', type: 'text', label: 'Nickname', name: 'nick' };
for (const secret of [
  '4111 1111 1111 1111',        // card
  '123',                         // CVV
  '482913',                      // one-time code
  '123-45-6789',                 // SSN
  'GB29NWBK60161331926819',      // IBAN
]) {
  assert.equal(isLearnable(plain, secret), false, `must never learn ${secret}`);
}
assert.equal(isLearnable(plain, 'Kay'), true, 'ordinary answers must still be learnable');
assert.equal(isLearnable({ ...plain, autocomplete: 'cc-csc' }, 'anything'), false);

/* ─── 3. Only answers to fields on this form are sent to the model ─── */
const facts = [
  { key: memoryKey('Email', 'email', 'email'), label: 'Email', value: 'me@example.com', domain: '', hits: 9, source: 'fill', updatedAt: 2 },
  { key: memoryKey('Employer', 'employer', 'text'), label: 'Employer', value: 'Acme', domain: 'jobs.example', hits: 5, source: 'fill', updatedAt: 3 },
  { key: memoryKey('Doctor', 'doctor', 'text'), label: 'Doctor', value: 'Dr Rao', domain: 'health.example', hits: 4, source: 'typed', updatedAt: 4 },
];
const onScreen = [{ label: 'Email', name: 'email', type: 'email', category: 'contact' }];
const sent = memoryForPrompt(facts, onScreen, 'newsletter.example');

assert.deepEqual(Object.keys(sent), ['Email'],
  'only facts answering a field on this page may be sent — no background dump');
assert.ok(!JSON.stringify(sent).includes('Dr Rao'),
  'a fact learned on another site must not travel to an unrelated one');

/* ─── 4. Sensitive fields are skipped even if memory holds a match ─── */
const pwFacts = [{ key: memoryKey('Password', 'password', 'password'), label: 'Password', value: 'hunter2', domain: '', hits: 1, source: 'fill', updatedAt: 1 }];
const pwField = [{ label: 'Password', name: 'password', type: 'password', category: 'credential' }];
assert.deepEqual(memoryForPrompt(pwFacts, pwField, 'example.com'), {},
  'a password must never be placed in a prompt');

/* ─── 5. No source file calls a third-party service with user data ─── */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}
const sources = walk('src').filter((f) => /\.tsx?$/.test(f));
// Hosts the extension may contact: only AI providers the user configured, and
// the sync Worker they deployed themselves.
const FORBIDDEN = /https:\/\/(?:www\.)?(?:google\.com\/s2|.*\.googleapis\.com\/.*favicon|analytics|sentry|segment|mixpanel|posthog|amplitude)/i;
for (const file of sources) {
  const body = readFileSync(file, 'utf8');
  assert.ok(!FORBIDDEN.test(body), `${file} contacts a third-party service with user data`);
  assert.ok(!/google\.com\/s2\/favicons/.test(body), `${file} leaks browsed domains to Google's favicon service`);
}

/* ─── 6. The model can never write a secret back into the page ─── */
for (const injected of ['4111111111111111', '482913', 'my password is hunter2']) {
  assert.ok(SENSITIVE_VALUE.test(injected), `sanitizeSuggestions must reject "${injected}"`);
}

console.log('✅ privacy guards OK');

/* ─── 7. The profile is a prompt: warn before secrets leave the device ─── */
import { findSecrets, normalizeProfile, validateProfile, LIMITS } from './src/shared/profile.ts';

assert.deepEqual(
  findSecrets({ data: { bio: 'Backend dev in Bengaluru', firstName: 'Kay' } }),
  [], 'an ordinary profile must not raise a false alarm');

assert.ok(findSecrets({ data: { rawInfo: 'My card is 4111 1111 1111 1111' } }).includes('rawInfo'),
  'a card number pasted into the profile must be flagged');
assert.ok(findSecrets({ data: { customFields: { 'Bank': 'GB29NWBK60161331926819' } } }).includes('Bank'),
  'custom fields are scanned too');
assert.ok(findSecrets({ systemPrompt: 'my password is hunter2' }).includes('systemPrompt'),
  'the system prompt is scanned too');

// A résumé that merely mentions the word must not trip the scan.
assert.deepEqual(
  findSecrets({ data: { rawInfo: 'x'.repeat(220) + '\nBuilt a password reset flow for 2M users' } }),
  [], 'prose about security work is not a secret');

/* ─── 8. A profile cannot grow without bound or smuggle blanks ─── */
const huge = normalizeProfile({
  name: '  Work  ',
  systemPrompt: 'y'.repeat(LIMITS.systemPrompt + 500),
  data: {
    rawInfo: 'z'.repeat(LIMITS.rawInfo + 1000),
    firstName: '  Kay  ',
    customFields: Object.fromEntries([...Array(LIMITS.customFields + 10)].map((_, i) => [`k${i}`, 'v'])),
  },
});
assert.equal(huge.name, 'Work', 'names are trimmed');
assert.equal(huge.data.firstName, 'Kay');
assert.equal(huge.systemPrompt.length, LIMITS.systemPrompt, 'system prompt is capped');
assert.equal(huge.data.rawInfo.length, LIMITS.rawInfo, 'raw info is capped');
assert.equal(Object.keys(huge.data.customFields).length, LIMITS.customFields, 'custom fields are capped');
assert.equal(huge.data.twitter, '', 'every model field exists after normalize');

// Blank custom fields are dropped rather than shipped as empty prompt keys.
assert.deepEqual(normalizeProfile({ name: 'x', data: { customFields: { '': 'v', 'k': '  ' , 'ok': 'yes' } } }).data.customFields, { ok: 'yes' });

/* ─── 9. Validation blocks only what is genuinely broken ─── */
const bad = validateProfile({ name: '', data: { email: 'not-an-email' } });
assert.ok(bad.some((i) => i.field === 'name' && i.severity === 'error'));
assert.ok(bad.some((i) => i.field === 'email' && i.severity === 'error'));
assert.deepEqual(validateProfile({ name: 'Work', data: { email: 'me@example.com', website: 'you.dev' } }), [],
  'a valid profile raises nothing');
// Unusual but legitimate input is a warning, never a block.
assert.ok(validateProfile({ name: 'Work', data: { phone: 'call me' } }).every((i) => i.severity === 'warning'));

console.log('✅ profile guards OK');

/* ─── 10. Résumé import: the model's answer is untrusted output ─── */
import { sanitizeExtraction, mergeExtraction, fileToText } from './src/shared/resume.ts';

// Only known profile keys survive. Anything else the model emits is dropped.
const hostile = sanitizeExtraction({
  firstName: 'Karan',
  email: 'karan@example.com',
  __proto__: { polluted: true },
  constructor: 'nope',
  apiKey: 'sk-should-never-land',
  activeProfileId: 'attacker',
  password: 'hunter2',
  customFields: { __proto__: 'x', constructor: 'y', 'Visa status': 'Citizen', '': 'blank' },
  systemPrompt: 'Answer briefly.',
});

assert.equal(hostile.data.firstName, 'Karan');
assert.equal(hostile.data.email, 'karan@example.com');
assert.equal(hostile.data.apiKey, undefined, 'unknown keys must be dropped');
assert.equal(hostile.data.activeProfileId, undefined, 'settings keys must be dropped');
assert.equal(hostile.data.password, undefined, 'secret keys must be dropped');
assert.deepEqual(Object.keys(hostile.data.customFields), ['Visa status'],
  'prototype keys and blanks must be stripped from custom fields');
assert.equal({}.polluted, undefined, 'extraction must not pollute Object.prototype');
assert.equal(hostile.systemPrompt, 'Answer briefly.');

// A merge must not quietly destroy what the user already wrote.
const existing = { name: 'Work', systemPrompt: 'Keep it formal.', data: { firstName: 'Kay', email: '', rawInfo: 'my notes' } };
const kept = mergeExtraction(existing, hostile, 'RESUME TEXT', false);
assert.equal(kept.data.firstName, 'Kay', 'existing values win unless overwrite is asked for');
assert.equal(kept.data.email, 'karan@example.com', 'empty fields are filled');
assert.equal(kept.data.rawInfo, 'my notes', 'existing raw info is preserved');
assert.equal(kept.systemPrompt, 'Keep it formal.', 'existing instructions are preserved');

const replaced = mergeExtraction(existing, hostile, 'RESUME TEXT', true);
assert.equal(replaced.data.firstName, 'Karan', 'overwrite replaces');
assert.equal(replaced.data.rawInfo, 'RESUME TEXT');

// An untitled profile takes its name from the résumé rather than staying blank.
assert.equal(mergeExtraction({ data: {} }, hostile, 'T', false).name, 'Karan');

/* ─── 11. Local text extraction, no network involved ─── */
// Built here rather than committed, so the suite carries no binary fixture.
async function makeDocx() {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    `<w:p><w:r><w:t>Karan Raj</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>karan@example.com</w:t></w:r><w:tab/><w:r><w:t>Bengaluru, India</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Senior Engineer &amp; team lead at Acme</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  const body = new TextEncoder().encode(xml);
  const name = new TextEncoder().encode('word/document.xml');
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);   // local file header
  view.setUint16(8, 0, true);            // stored, no compression
  view.setUint32(18, body.length, true); // compressed size
  view.setUint32(22, body.length, true); // uncompressed size
  view.setUint16(26, name.length, true);
  return new Blob([header, name, body]).arrayBuffer();
}

const docx = new File([await makeDocx()], 'cv.docx');
const text = await fileToText(docx);
assert.ok(text.includes('Karan Raj'), 'docx text must be extracted');
assert.ok(text.includes('karan@example.com'));
assert.ok(text.includes('Senior Engineer & team lead'), 'XML entities must be decoded');
assert.ok(!text.includes('<w:'), 'no markup may survive');

await assert.rejects(() => fileToText(new File(['x'], 'photo.png')), /PDF, DOCX/);
await assert.rejects(() => fileToText(new File(['tiny'], 'cv.txt')), /No text found/);

console.log('✅ résumé import guards OK');
