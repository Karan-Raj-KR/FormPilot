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
