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
