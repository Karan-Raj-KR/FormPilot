-- FormPilot server schema.
--
-- The server is deliberately ignorant: it knows who you are and holds an opaque
-- ciphertext for you. It never holds a key that can open that ciphertext, so a
-- full database dump reveals email addresses and nothing else.

-- ─── Accounts ───
-- One row per person. `password_hash` is a server-side PBKDF2 over the *client*
-- auth hash, which is itself 600k PBKDF2 rounds away from the real password —
-- the plaintext password never reaches this machine.
-- `kdf_salt` is public by design: the client needs it to re-derive its own
-- encryption key on a new laptop, and it is useless without the passphrase.
CREATE TABLE IF NOT EXISTS accounts (
  user_id        TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,          -- normalized: trimmed + lowercased
  email_verified INTEGER NOT NULL DEFAULT 0,
  password_hash  TEXT,                          -- NULL for Google-only / OTP-only accounts
  password_salt  TEXT,
  kdf_salt       TEXT NOT NULL,                 -- client key derivation salt
  google_sub     TEXT UNIQUE,                   -- set once a Google identity is linked
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_accounts_google ON accounts(google_sub);

-- ─── Sessions ───
-- Only the SHA-256 of the token is stored, so a database leak cannot be replayed
-- as a login. Rotated on every refresh.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device     TEXT,
  FOREIGN KEY (user_id) REFERENCES accounts(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

-- ─── One-time codes ───
-- Used for both email verification and passwordless login. Hashed, single-use,
-- short-lived, and attempt-capped so a six-digit code cannot be brute forced.
CREATE TABLE IF NOT EXISTS otp_codes (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  purpose    TEXT NOT NULL,                     -- 'verify' | 'login' | 'reset'
  attempts   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, purpose);
CREATE INDEX IF NOT EXISTS idx_otp_expiry ON otp_codes(expires_at);

-- ─── Rate limits ───
-- Fixed-window counters. Keyed by action + subject (email or IP).
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- ─── Encrypted vault ───
-- `blob` is AES-256-GCM ciphertext produced in the browser. This server has no
-- way to read it. `updated_at` is the server clock and drives conflict handling.
CREATE TABLE IF NOT EXISTS vaults (
  user_id    TEXT PRIMARY KEY,
  blob       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES accounts(user_id) ON DELETE CASCADE
);
