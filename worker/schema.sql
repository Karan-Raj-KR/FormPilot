-- One row per Google account. `blob` is AES-GCM ciphertext produced in the
-- browser; this server has no way to read it.
CREATE TABLE IF NOT EXISTS vaults (
  user_id    TEXT PRIMARY KEY,
  blob       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
