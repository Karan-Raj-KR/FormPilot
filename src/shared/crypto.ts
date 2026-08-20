/* ─────────────────────────────────────────────────
   FormPilot — end-to-end encryption for synced data.

   The threat model in one line: assume the server is hostile and the database
   leaks. Everything below is arranged so that in that case an attacker learns
   your email address and nothing else.

   Two values are derived from one secret:
     masterKey     = PBKDF2(secret, kdfSalt, 600k)     — never leaves the device
     authHash      = PBKDF2(masterKey, secret, 1)      — the only part sent up
     encryptionKey = HKDF(masterKey, "formpilot-enc")  — never leaves the device

   The server stores PBKDF2(authHash, serverSalt, 210k). Working back from that
   to the encryption key means breaking 600k PBKDF2 rounds first.
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

export function randomSalt(): string {
  return toBase64(randomBytes(SALT_BYTES));
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

async function deriveBits(secret: string, salt: string, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return new Uint8Array(bits);
}

/* ─── Account key material ───
   Turns one secret into the two things sync needs: a proof to show the server,
   and a key it must never see. The same secret + kdfSalt on a second laptop
   reproduces both exactly, which is what makes cross-device sync possible
   without the server ever holding a key. */
export interface KeyMaterial {
  /** Sent to the server as proof of identity. Cannot decrypt anything. */
  authHash: string;
  /** Stays here. Base64 of the raw key, for handing to storage.session. */
  encryptionKey: string;
}

export async function deriveKeyMaterial(secret: string, kdfSalt: string): Promise<KeyMaterial> {
  const master = await deriveBits(secret, kdfSalt, PBKDF2_ITERATIONS);
  const masterB64 = toBase64(master);

  // One extra round with the secret as salt. Cheap for us, but it means the
  // value on the wire is not the master key itself.
  const auth = await deriveBits(masterB64, secret, 1);

  // Separate the encryption key from the auth value so that learning one tells
  // you nothing about the other.
  const encryption = await deriveBits(masterB64, 'formpilot-enc-v1', 1);

  return { authHash: toBase64(auth), encryptionKey: toBase64(encryption) };
}

async function importRawKey(rawBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw', fromBase64(rawBase64), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/* ─── Blob encryption ───
   Both entry points accept either a raw derived key (the account flow) or a
   plain passphrase (the standalone export flow), so there is one implementation
   rather than two that can drift apart. */
type Secret = { rawKey: string } | { passphrase: string };

export async function encryptJSON(data: unknown, secret: Secret | string): Promise<EncryptedBlob> {
  // A fresh salt and IV per encryption — reusing an AES-GCM nonce under the
  // same key breaks the cipher outright.
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await resolveKey(secret, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data)),
  );
  return { v: 1, salt: toBase64(salt), iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

export async function decryptJSON<T>(blob: EncryptedBlob, secret: Secret | string): Promise<T> {
  if (blob?.v !== 1) throw new Error('Unrecognised backup format.');
  const key = await resolveKey(secret, fromBase64(blob.salt));
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ct),
    );
  } catch {
    // AES-GCM authentication failure — wrong key, or tampered ciphertext. The
    // two are indistinguishable by design, and both mean "do not trust this".
    throw new Error('Could not decrypt your data. Check the passphrase you signed in with.');
  }
  return JSON.parse(dec.decode(plain)) as T;
}

function resolveKey(secret: Secret | string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (typeof secret === 'string') return deriveKey(secret, salt);
  if ('rawKey' in secret) return importRawKey(secret.rawKey);
  return deriveKey(secret.passphrase, salt);
}
