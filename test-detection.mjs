/* Field-routing check — run with: node test-detection.mjs
   Guards the two bugs that silently sent card/password fields to the LLM
   and put the card number into the cardholder-name box. */
import assert from 'node:assert/strict';
import { inferCategory, PAYMENT_FIELD_PATTERNS } from './src/shared/constants.ts';

// Mirrors Preview.tsx getCardValueForField — same order, same patterns.
function cardFieldFor(label) {
  const l = label.toLowerCase();
  if (PAYMENT_FIELD_PATTERNS.cvv.test(l)) return 'cvv';
  if (PAYMENT_FIELD_PATTERNS.cardholderName.test(l)) return 'cardholderName';
  if (PAYMENT_FIELD_PATTERNS.expiryMonth.test(l)) return 'expiryMonth';
  if (PAYMENT_FIELD_PATTERNS.expiryYear.test(l)) return 'expiryYear';
  if (PAYMENT_FIELD_PATTERNS.expiryFull.test(l)) return 'expiryFull';
  if (PAYMENT_FIELD_PATTERNS.cardNumber.test(l)) return 'cardNumber';
  return '';
}

// Sensitive fields must route to the vault, never to the AI prompt.
assert.equal(inferCategory('Password', 'password', 'pass'), 'credential');
assert.equal(inferCategory('Username', 'text', 'username'), 'credential');
assert.equal(inferCategory('Card number', 'text', 'cardnumber'), 'payment');
assert.equal(inferCategory('CVV', 'text', 'cvc'), 'payment');
assert.equal(inferCategory('Name on card', 'text', 'ccname'), 'payment');
assert.equal(inferCategory('Expiration date', 'text', 'exp'), 'payment');

// Ordinary fields must stay with the AI — email is not a credential.
assert.equal(inferCategory('Email address', 'email', 'email'), 'contact');
assert.equal(inferCategory('First name', 'text', 'fname'), 'personal');
assert.equal(inferCategory('Why do you want this job?', 'textarea', 'why'), 'essay');

// Loose patterns must not swallow the specific ones.
assert.equal(cardFieldFor('Name on card'), 'cardholderName');
assert.equal(cardFieldFor('Card number'), 'cardNumber');
assert.equal(cardFieldFor('CVV'), 'cvv');
assert.equal(cardFieldFor('Expiry month'), 'expiryMonth');
assert.equal(cardFieldFor('Expiration date'), 'expiryFull');

console.log('✅ field routing OK');

/* ─── Memory: what it learns, and what it must never learn ─── */
import { memoryKey, isLearnable, recall, memoryForPrompt } from './src/shared/memory.ts';

// The same question written five ways collapses to one key.
const key = memoryKey('First Name *', 'first_name', 'text');
for (const variant of [
  memoryKey('first name', 'firstName', 'text'),
  memoryKey('  FIRST   NAME  ', 'first-name', 'text'),
  memoryKey('Your first name', 'first_name', 'text'),
]) assert.equal(variant, key, `"${variant}" should normalize to "${key}"`);

// …but two different questions must not.
assert.notEqual(memoryKey('First name', 'fname', 'text'), memoryKey('Last name', 'lname', 'text'));

// Secrets never enter memory, whatever the field claims to be.
const plain = { category: 'contact', type: 'text', label: 'Email', name: 'email' };
assert.equal(isLearnable(plain, 'me@example.com'), true);
assert.equal(isLearnable({ ...plain, type: 'password' }, 'hunter2'), false);
assert.equal(isLearnable({ ...plain, category: 'payment' }, 'Visa'), false);
assert.equal(isLearnable({ ...plain, category: 'credential' }, 'karan'), false);
assert.equal(isLearnable(plain, '4111 1111 1111 1111'), false, 'card numbers must never be learned');
assert.equal(isLearnable(plain, '123'), false, 'bare 3-4 digit values look like CVVs');
assert.equal(isLearnable({ ...plain, label: 'API key' }, 'abcdefgh'), false);
assert.equal(isLearnable(plain, ''), false);
assert.equal(isLearnable(plain, 'x'.repeat(401)), false);

// Recall prefers the answer given on this exact site over the general one.
const facts = [
  { key: memoryKey('Username', 'username', 'text'), label: 'Username', value: 'global-me', domain: '', hits: 3, source: 'fill', updatedAt: 1 },
  { key: memoryKey('Username', 'username', 'text'), label: 'Username', value: 'site-me', domain: 'example.com', hits: 1, source: 'fill', updatedAt: 2 },
];
const field = { label: 'Username', name: 'username', type: 'text' };
assert.equal(recall(facts, field, 'example.com').value, 'site-me');
assert.equal(recall(facts, field, 'other.com').value, 'global-me');
assert.equal(recall(facts, { label: 'Nickname', name: 'nick', type: 'text' }, 'example.com'), undefined);

// The prompt slice leads with facts that answer fields actually on screen.
const prompt = memoryForPrompt(facts, [field], 'example.com');
assert.equal(prompt['Username'], 'site-me');

console.log('✅ memory OK');
