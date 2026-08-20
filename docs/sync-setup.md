# Sync setup

FormPilot works fully offline. This is only needed if you want your profiles,
memory, cards and passwords to follow you between machines.

The whole backend is one Cloudflare Worker and one SQLite database. Free tier is
plenty — the server stores one encrypted blob per person.

---

## What the server can and cannot see

| | Stored on the server | Readable by the server |
|---|---|---|
| Email address | yes | yes |
| Session tokens | SHA-256 hash only | no |
| Password | never sent | no |
| Profiles, memory, cards, passwords | yes, as one AES-256-GCM blob | **no** |

The encryption key is derived in your browser from your password and a public
salt. It is never transmitted. If someone dumps the database they get a list of
email addresses and a pile of ciphertext.

The flip side: **there is no password reset that recovers your data.** Losing
the password means the blob stays sealed forever, for you and for us.

---

## 1. Create the database

```bash
cd worker
npm install
npx wrangler d1 create formpilot
```

Copy the printed `database_id` into `wrangler.toml`, then create the tables:

```bash
npm run db:init
```

## 2. Set the secrets

```bash
# Any long random string. Used to make "unknown email" responses
# indistinguishable from real ones.
npx wrangler secret put SALT_PEPPER

# Email delivery, for verification and sign-in codes. Sign up at resend.com,
# verify your sending domain, then create an API key.
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM     # e.g. FormPilot <login@yourdomain.com>
```

Generate a pepper with `openssl rand -base64 48`.

Without `RESEND_API_KEY` and `MAIL_FROM`, email sign-up returns a clear 503
rather than silently pretending to send. Google sign-in still works.

## 3. Deploy

```bash
npm run deploy
```

Check it:

```bash
curl https://formpilot-sync.<your-subdomain>.workers.dev/health
# {"ok":true,"emailConfigured":true}
```

## 4. Point the extension at it

In `src/shared/config.ts`:

```ts
export const SYNC_API_URL = 'https://formpilot-sync.<your-subdomain>.workers.dev';
```

Rebuild with `npm run build`. Email sign-in works from here.

## 5. Google sign-in (optional)

1. Load the unpacked extension and copy its ID from `chrome://extensions`.
2. In the [Google Cloud console](https://console.cloud.google.com/apis/credentials),
   create an OAuth client ID of type **Web application**.
3. Add this authorised redirect URI — the trailing slash matters:
   ```
   https://<your-extension-id>.chromiumapp.org/
   ```
4. Put the client ID in **both** `src/shared/config.ts` and `worker/wrangler.toml`,
   then `npm run build` and `npm run deploy`.

The Worker rejects any token whose `aud` is not this exact client ID, so both
copies must match.

---

## Using two laptops

1. Sign in on the first laptop and let it sync once.
2. Sign in on the second with the same email.
3. Enter the same password (or, for Google/code accounts, the same encryption
   passphrase) to unlock.

From then on it is automatic: a pull every 5 minutes, and a push a few seconds
after you change anything.

Both sides are **merged**, not overwritten. Add a card on one laptop and a
password on the other and you end up with both. When the same record is edited
in two places, the newer edit wins. Deletions are recorded as tombstones so a
deleted card does not come back from the other machine.

`Force push` and `Force pull` under Advanced deliberately throw one side away.
They are there for the rare case where you know one device is wrong.

---

## Local development

```bash
cd worker
npm run db:local
npx wrangler dev
```

Set `DEV_ECHO_CODES = "1"` in `wrangler.toml` to have one-time codes returned in
the HTTP response — the popup shows them — so you can test sign-up without an
email provider. Never deploy with that on.

Point `SYNC_API_URL` at `http://localhost:8787` while developing.

---

## Troubleshooting

**"Google rejected the redirect URI"** — the URI in the Cloud console must be
exactly `https://<extension-id>.chromiumapp.org/`, trailing slash included. The
extension ID changes if you reload an unpacked extension from a different folder.

**"Verify your email before syncing"** — the account exists but the code was
never entered. Sign in again and it re-sends one.

**"Could not decrypt your data"** — the passphrase does not match the one used to
encrypt the server copy. There is no reset. If the server copy is expendable,
use `Delete server copy` and push fresh from a device that still has your data.

**Codes never arrive** — check `/health` for `emailConfigured`, then check the
Resend dashboard. Unverified sending domains silently drop mail to addresses
other than your own.
