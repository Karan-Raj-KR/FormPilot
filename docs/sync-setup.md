# Cross-device sync — setup

Sync is **off until you deploy your own backend**. Everything else in FormPilot
works without it. Budget about 20 minutes.

What you get: your profiles, API keys, payment cards and passwords follow you to
any machine and any browser that supports the `identity` extension API. Your data
is encrypted on-device with a passphrase before it is uploaded — the server (yours
or anyone else's) only ever holds ciphertext.

> **The passphrase is not recoverable.** It never leaves your device and is never
> stored. If you forget it, the synced copy is permanently unreadable. Use a
> password manager.

---

## 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login

# Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create formpilot

npm run db:init      # creates the vaults table
npm run deploy       # prints your Worker URL
```

Note the URL — e.g. `https://formpilot-sync.your-name.workers.dev`.

## 2. Get your extension ID

Load `dist/` unpacked at `chrome://extensions` (Developer mode on) and copy the
32-character extension ID.

## 3. Create the Google OAuth client

At [console.cloud.google.com](https://console.cloud.google.com):

1. **New Project** → name it FormPilot.
2. **APIs & Services → OAuth consent screen** → External. Fill in app name and
   your email. Scopes: `openid` and `.../auth/userinfo.email` only — nothing
   sensitive, so no Google verification review is needed.
3. Add your own Google account under **Test users** (required while the app is
   in testing, or sign-in is refused).
4. **Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application** — *not* "Chrome app". The Chrome app
     type only works with `chrome.identity.getAuthToken`, which is Chrome-only;
     the web type works with `launchWebAuthFlow` in every browser.
   - Authorised redirect URI: `https://<your-extension-id>.chromiumapp.org/`
     (trailing slash included).
5. Copy the client ID.

## 4. Wire it up

Put the client ID in **both** places — they must match, since the Worker rejects
tokens minted for any other client:

- `src/shared/config.ts` → `GOOGLE_CLIENT_ID`, and `SYNC_API_URL` (Worker URL, no
  trailing slash)
- `worker/wrangler.toml` → `[vars] GOOGLE_CLIENT_ID`, then `npm run deploy` again

Then rebuild and reload the extension:

```bash
npm run build
```

## 5. Use it

Open the extension → **Sync** tab → *Sign in with Google* → enter a passphrase →
**Sync now**. On a second machine: install, sign in with the same Google account,
enter the same passphrase, then **Pull**.

- **Sync now** — pulls if the server is newer, otherwise pushes.
- **Push** — overwrites the server with this device.
- **Pull** — overwrites this device with the server.

If a push is refused with *"another device synced more recently"*, pull first.
That guard exists so a stale device can't silently erase newer data.

---

## What is stored where

| Where | What | Readable by |
|---|---|---|
| `chrome.storage.local` | everything, in plaintext | this extension, on this device |
| Your D1 database | one AES-256-GCM blob per account | nobody without your passphrase |
| Google | your email address and account id | Google (sign-in only) |

Key derivation is PBKDF2-SHA256, 600,000 iterations, with a random 16-byte salt
and a fresh 12-byte nonce per upload.
