/* ─────────────────────────────────────────────────
   FormPilot — end-to-end encryption for synced data.
   The passphrase never leaves this device: the server only ever
   receives the ciphertext produced here.
   ───────────────────────────────────────────────── */

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 floor for PBKDF2-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12;              // AES-GCM standard nonce length

export interface EncryptedBlob {
  v: 1;
  salt: string; // base64
  iv: string;   // base64
  ct: string;   // base64
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(data: unknown, passphrase: string): Promise<EncryptedBlob> {
  // A fresh salt and IV per encryption — reusing an AES-GCM nonce under the
  // same key breaks the cipher outright.
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)),
  );
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function decryptJSON<T>(blob: EncryptedBlob, passphrase: string): Promise<T> {
  if (blob?.v !== 1) throw new Error('Unrecognised backup format.');
  const key = await deriveKey(passphrase, fromBase64(blob.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ct),
    );
  } catch {
    // AES-GCM authentication failure — wrong passphrase, or tampered ciphertext.
    throw new Error('Wrong passphrase — could not decrypt your synced data.');
  }
  return JSON.parse(dec.decode(plain)) as T;
}
