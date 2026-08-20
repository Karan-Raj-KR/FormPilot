/* ─────────────────────────────────────────────────
   Deployment config — edit these two values, then rebuild.
   Setup instructions: docs/sync-setup.md
   ───────────────────────────────────────────────── */

// Google OAuth 2.0 client ID, application type "Web application".
// Authorised redirect URI must be https://<your-extension-id>.chromiumapp.org/
export const GOOGLE_CLIENT_ID = '';

// Your deployed Cloudflare Worker, no trailing slash.
// e.g. https://formpilot-sync.<your-subdomain>.workers.dev
export const SYNC_API_URL = '';

export const SYNC_CONFIGURED = Boolean(GOOGLE_CLIENT_ID && SYNC_API_URL);
