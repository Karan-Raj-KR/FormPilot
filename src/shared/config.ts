/* ─────────────────────────────────────────────────
   Deployment config — set these, then rebuild.
   Full walkthrough: docs/sync-setup.md
   ───────────────────────────────────────────────── */

// Your deployed Cloudflare Worker, no trailing slash.
// e.g. https://formpilot-sync.<your-subdomain>.workers.dev
export const SYNC_API_URL = '';

// Optional. Google OAuth 2.0 client ID, application type "Web application".
// Authorised redirect URI must be https://<your-extension-id>.chromiumapp.org/
// Leave empty to offer email sign-in only — everything else still works.
export const GOOGLE_CLIENT_ID = '';

// Sync needs the Worker. Google is an extra way in, not a requirement.
export const SYNC_CONFIGURED = Boolean(SYNC_API_URL);
