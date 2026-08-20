# Security & privacy

FormPilot handles the most sensitive data a person has: identity documents,
card numbers, passwords. This is what protects it, and what does not.

## Where data lives

| Data | Stored | Leaves the device? |
|---|---|---|
| Profiles, memory, history | `chrome.storage.local`, plaintext | Only inside a prompt, and only the fields the open form asks for |
| API keys | `chrome.storage.local`, plaintext | Only as the `Authorization` header to the provider you chose |
| Payment cards, passwords | `chrome.storage.local`, plaintext | **Never sent to a model.** Encrypted before sync upload |
| Sync copy | Your Cloudflare D1 | AES-256-GCM ciphertext only |

`chrome.storage.local` is sandboxed per-extension: other extensions and web
pages cannot read it. It is *not* encrypted at rest — anyone with your unlocked
OS user account and disk access can read it, exactly as with Chrome's own saved
passwords. Full-disk encryption is the defence there.

## What never reaches an AI provider

The model is a third party. These never appear in a prompt:

- **Passwords and card data.** Vault fields are filled locally, on the popup
  side, after the model has already answered. The model is not asked about them
  and cannot see them.
- **The value already typed into a sensitive field.** The content script blanks
  `currentValue` for anything matching `isSensitiveField` before it leaves the
  frame; the prompt builder checks again before serialising.
- **Anything secret-shaped.** Card numbers, CVVs, one-time codes, SSNs and IBANs
  are rejected by pattern (`SENSITIVE_VALUE`) at four points: typing capture,
  learning, prompt assembly, and model output.
- **Memory from other sites.** Only facts answering a field on the form in front
  of you are sent. A fact learned at your bank is not uploaded while you fill a
  newsletter signup.

## Prompt injection

Page titles, headings and button labels are scraped and given to the model so it
knows which company is asking. That text is attacker-controlled, so it is fenced
into an `UNTRUSTED DATA` block and the model is told not to follow instructions
inside it.

That instruction is a mitigation, not a guarantee — models can be talked round.
The real defence is that a compromised answer cannot do much: the model has no
access to the vault, and every value is shown to you for review before anything
is written to the page. As a backstop, `sanitizeSuggestions` drops any model
output that looks like a secret.

## Learning from typing

With `learnFromTyping` on, the extension records values you type into forms.
It is not a keylogger: it reads only on `change`/`focusout` (a finished edit,
never keystrokes), and it refuses before the value leaves the page frame for
password fields, `autocomplete="cc-*" | one-time-code | current-password |
new-password`, anything categorised payment or credential, and any
secret-shaped value.

Everything learned is listed in the **Memory** tab, where each fact can be
edited or deleted. Turn the whole thing off in Settings.

## Extension surface

- **Content Security Policy**: `script-src 'self'` — no remote code, no `eval`.
  `frame-ancestors 'none'` so the popup cannot be embedded.
- **No `externally_connectable`**: web pages cannot message the extension.
  Both message listeners additionally check `sender.id === chrome.runtime.id`.
- **No analytics, no telemetry, no remote fonts or icons.** Site favicons are
  drawn locally; fetching them from Google's favicon service would have handed
  Google the list of every site you fill forms on.
- **Permissions**: `storage`, `activeTab`, `scripting`, `identity`, `alarms`,
  and `<all_urls>` — the last is unavoidable for an extension that fills forms
  on any site you visit.

## Sync

- Encryption: AES-256-GCM, key from PBKDF2-SHA256 at 600,000 iterations, fresh
  16-byte salt and 12-byte nonce per upload.
- The passphrase is never stored, never transmitted, and cannot be reset. Lose
  it and the synced copy is unreadable — by you or anyone else.
- The Worker verifies the Google `id_token`'s signature audience (`aud`),
  issuer and expiry, and keys rows by Google `sub`. It stores ciphertext only.
- Stale pushes are rejected (409) so a device that has been offline cannot
  overwrite newer data.

## Verifying it

```bash
node test-privacy.mjs     # leak guards: what may and may not leave the device
node test-crypto.mjs      # encryption round-trip, wrong passphrase, nonce reuse
node test-detection.mjs   # sensitive-field classification and memory rules
```

## Known limits

- Local storage is not encrypted at rest.
- A user who pastes an API key belonging to someone else, or points the custom
  provider at a hostile endpoint, sends their prompts there. The base URL is
  shown in Settings for that reason.
- Prompt-injection mitigation is best-effort, as above.

Found a problem? Open an issue with reproduction steps — please do not include
real card numbers or passwords in the report.
