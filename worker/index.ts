/* ─────────────────────────────────────────────────
   FormPilot sync Worker.

   Stores one encrypted blob per Google account. The ciphertext is produced
   in the browser (src/shared/crypto.ts) and this Worker never sees the
   passphrase, so a database dump reveals nothing usable.
   ───────────────────────────────────────────────── */

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
}

const MAX_BLOB_BYTES = 2 * 1024 * 1024; // generous for profiles + history, bounded

function json(body: unknown, status = 200, extra: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(), ...extra },
  });
}

// The extension calls from a chrome-extension:// origin, which is opaque, so
// this allows any origin. That is safe here because every request must carry a
// valid Google id token minted for our own client id — the origin grants nothing.
function cors(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/** Verifies the Google id token and returns the stable account id (`sub`). */
async function authenticate(request: Request, env: Env): Promise<string | null> {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;

  const claims: any = await res.json();
  // aud must be our own client, or anyone could sign in to their own Google app
  // and present that token here.
  if (claims.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null;
  if (Number(claims.exp) * 1000 < Date.now()) return null;
  return claims.sub || null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    const url = new URL(request.url);
    if (url.pathname !== '/sync') return json({ error: 'Not found' }, 404);

    const userId = await authenticate(request, env);
    if (!userId) return json({ error: 'Unauthorized' }, 401);

    if (request.method === 'GET') {
      const row = await env.DB.prepare('SELECT blob, updated_at FROM vaults WHERE user_id = ?')
        .bind(userId).first<{ blob: string; updated_at: number }>();
      if (!row) return json({ error: 'No data stored yet' }, 404);
      return json({ blob: JSON.parse(row.blob), updatedAt: row.updated_at });
    }

    if (request.method === 'PUT') {
      const body: any = await request.json().catch(() => null);
      if (!body?.blob?.ct || !body?.blob?.iv || !body?.blob?.salt) {
        return json({ error: 'Expected an encrypted blob' }, 400);
      }
      const serialized = JSON.stringify(body.blob);
      if (serialized.length > MAX_BLOB_BYTES) return json({ error: 'Payload too large' }, 413);

      // Conflict guard: refuse the write if another device stored a newer copy
      // than the one this device last saw, so a stale push can't silently
      // discard the other machine's data.
      const existing = await env.DB.prepare('SELECT updated_at FROM vaults WHERE user_id = ?')
        .bind(userId).first<{ updated_at: number }>();
      if (existing && existing.updated_at > Number(body.baseUpdatedAt ?? 0)) {
        return json({ error: 'Server copy is newer', updatedAt: existing.updated_at }, 409);
      }

      const updatedAt = Date.now();
      await env.DB.prepare(
        `INSERT INTO vaults (user_id, blob, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`,
      ).bind(userId, serialized, updatedAt).run();
      return json({ updatedAt });
    }

    if (request.method === 'DELETE') {
      await env.DB.prepare('DELETE FROM vaults WHERE user_id = ?').bind(userId).run();
      return json({ deleted: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  },
};
