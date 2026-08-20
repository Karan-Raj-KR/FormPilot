/* ─────────────────────────────────────────────────
   FormPilot sync Worker.

   Two jobs, and deliberately no third:
     1. Prove who you are — Google, email + password, or an emailed code.
     2. Hold one opaque ciphertext per account.

   The encryption key is derived in the browser and never sent here, so this
   server cannot read a single field of anyone's data. See SECURITY.md.
   ───────────────────────────────────────────────── */

interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  /** Secret. Signs the decoy KDF salt returned for unknown emails. */
  SALT_PEPPER: string;
  /** Secret. Resend API key. Without it, codes cannot be delivered. */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  APP_NAME?: string;
  /** "1" returns OTP codes in the HTTP response. Local development only. */
  DEV_ECHO_CODES?: string;
}

const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days, rotated on refresh
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const PASSWORD_HASH_ROUNDS = 210_000;               // OWASP 2023 PBKDF2-SHA256 floor

/* ─────────────── helpers ─────────────── */

function cors(): HeadersInit {
  // The extension calls from an opaque chrome-extension:// origin, so origin
  // checks buy nothing here. Every mutating request carries a bearer token
  // instead, and no cookies are used, so there is no CSRF surface to protect.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors() },
  });
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(input: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(input))));
}

/** Constant-time string compare — an early return leaks the match position. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(secret: string, salt: string, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations, hash: 'SHA-256' },
    material,
    256,
  );
  return b64url(new Uint8Array(bits));
}

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message))));
}

// Case and stray whitespace must not fork one inbox into two accounts that
// each hold half the user's data. Dots and +tags are left alone deliberately:
// only some providers treat them as noise, and guessing wrong merges two
// genuinely different people.
function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null;
  return email;
}

function sixDigitCode(): string {
  // Rejection-free modulo bias is irrelevant at this range, but use the full
  // 32-bit draw rather than Math.random, which is not a CSPRNG.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

/* ─────────────── rate limiting ─────────────── */

/** Fixed-window counter. Returns false when the caller is over budget. */
async function allow(env: Env, action: string, subject: string, limit: number, windowMs: number): Promise<boolean> {
  const bucket = `${action}:${subject}`;
  const now = Date.now();
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?')
    .bind(bucket).first<{ count: number; window_start: number }>();

  if (!row || now - row.window_start > windowMs) {
    await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start`,
    ).bind(bucket, now).run();
    return true;
  }
  if (row.count >= limit) return false;
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').bind(bucket).run();
  return true;
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

/* ─────────────── email delivery ─────────────── */

async function sendCode(env: Env, email: string, code: string, purpose: string): Promise<void> {
  const app = env.APP_NAME || 'FormPilot';
  const subject = purpose === 'verify' ? `${app}: verify your email` : `${app}: your sign-in code`;
  const line = purpose === 'verify'
    ? 'Use this code to finish setting up your account:'
    : 'Use this code to sign in:';

  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    // Nothing configured. Fail loudly rather than pretending a code was sent —
    // a user staring at an empty inbox has no way to diagnose this.
    throw new HttpError(503, 'Email delivery is not configured on the server. Set RESEND_API_KEY and MAIL_FROM.');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject,
      text: `${line}\n\n    ${code}\n\nIt expires in 10 minutes. If you didn't ask for this, ignore this email — nothing has changed.\n\n— ${app}`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Email send failed', res.status, detail);
    throw new HttpError(502, 'Could not send the email. Try again in a moment.');
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/* ─────────────── one-time codes ─────────────── */

async function issueCode(env: Env, email: string, purpose: string): Promise<string> {
  const code = sixDigitCode();
  const now = Date.now();

  // Any earlier code for this purpose dies now: two live codes double the
  // guessing surface for no benefit.
  await env.DB.prepare('UPDATE otp_codes SET consumed = 1 WHERE email = ? AND purpose = ? AND consumed = 0')
    .bind(email, purpose).run();

  await env.DB.prepare(
    'INSERT INTO otp_codes (id, email, code_hash, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), email, await sha256(`${email}:${code}`), purpose, now, now + OTP_TTL_MS).run();

  return code;
}

/** Verifies and burns a code. Throws with a user-facing reason on failure. */
async function consumeCode(env: Env, email: string, purpose: string, code: unknown): Promise<void> {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
    throw new HttpError(400, 'Enter the 6-digit code from your email.');
  }

  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at FROM otp_codes
     WHERE email = ? AND purpose = ? AND consumed = 0
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(email, purpose).first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();

  if (!row) throw new HttpError(400, 'No code is waiting. Request a new one.');
  if (row.expires_at < Date.now()) throw new HttpError(400, 'That code has expired. Request a new one.');
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many wrong attempts. Request a new code.');
  }

  const matches = timingSafeEqual(row.code_hash, await sha256(`${email}:${code.trim()}`));
  if (!matches) {
    await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
    throw new HttpError(400, left > 0 ? `That code is wrong. ${left} attempt${left === 1 ? '' : 's'} left.` : 'That code is wrong. Request a new one.');
  }

  await env.DB.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').bind(row.id).run();
}

/* ─────────────── sessions ─────────────── */

async function createSession(env: Env, userId: string, device: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, device) VALUES (?, ?, ?, ?, ?)',
  ).bind(await sha256(token), userId, now, expiresAt, device.slice(0, 100)).run();

  // Opportunistic cleanup — no cron needed for a table this small.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();
  return { token, expiresAt };
}

interface Identity { userId: string; email: string; verified: boolean }

/** Resolves the bearer token: a FormPilot session, or a Google id token. */
async function authenticate(request: Request, env: Env): Promise<Identity | null> {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  // A Google id token is a JWT; a session token is opaque base64url with no dots.
  if (token.split('.').length === 3) return authenticateGoogle(token, env);

  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires_at, a.email, a.email_verified
     FROM sessions s JOIN accounts a ON a.user_id = s.user_id
     WHERE s.token_hash = ?`,
  ).bind(await sha256(token)).first<{ user_id: string; expires_at: number; email: string; email_verified: number }>();

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return null;
  }
  return { userId: row.user_id, email: row.email, verified: row.email_verified === 1 };
}

/** Verifies a Google id token and upserts the matching account. */
async function authenticateGoogle(token: string, env: Env): Promise<Identity | null> {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const claims: any = await res.json();

  // aud must be our own client: anyone can mint a valid Google token for *their*
  // app, and accepting it would let them log in as any of our users.
  if (claims.aud !== env.GOOGLE_CLIENT_ID) return null;
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null;
  if (Number(claims.exp) * 1000 < Date.now()) return null;
  if (claims.email_verified !== true && claims.email_verified !== 'true') return null;

  const email = normalizeEmail(claims.email);
  if (!email || !claims.sub) return null;

  const account = await getOrCreateGoogleAccount(env, claims.sub, email);
  return { userId: account.user_id, email, verified: true };
}

interface AccountRow {
  user_id: string; email: string; email_verified: number;
  password_hash: string | null; password_salt: string | null;
  kdf_salt: string; google_sub: string | null;
}

async function getOrCreateGoogleAccount(env: Env, sub: string, email: string): Promise<AccountRow> {
  const bySub = await env.DB.prepare('SELECT * FROM accounts WHERE google_sub = ?').bind(sub).first<AccountRow>();
  if (bySub) return bySub;

  // Same inbox, arriving via Google this time. Link rather than fork the
  // account — otherwise the user's data silently splits in two.
  const byEmail = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first<AccountRow>();
  if (byEmail) {
    await env.DB.prepare('UPDATE accounts SET google_sub = ?, email_verified = 1 WHERE user_id = ?')
      .bind(sub, byEmail.user_id).run();
    return { ...byEmail, google_sub: sub, email_verified: 1 };
  }

  const row: AccountRow = {
    user_id: crypto.randomUUID(),
    email,
    email_verified: 1,           // Google already verified this inbox
    password_hash: null,
    password_salt: null,
    kdf_salt: randomToken(16),
    google_sub: sub,
  };
  await env.DB.prepare(
    `INSERT INTO accounts (user_id, email, email_verified, kdf_salt, google_sub, created_at)
     VALUES (?, ?, 1, ?, ?, ?)`,
  ).bind(row.user_id, row.email, row.kdf_salt, sub, Date.now()).run();
  return row;
}

async function findAccount(env: Env, email: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first<AccountRow>();
}

function identityPayload(account: AccountRow) {
  return {
    userId: account.user_id,
    email: account.email,
    verified: account.email_verified === 1,
    kdfSalt: account.kdf_salt,
    hasPassword: Boolean(account.password_hash),
    hasGoogle: Boolean(account.google_sub),
  };
}

/* ─────────────── routes ─────────────── */

async function handleAuth(path: string, request: Request, env: Env): Promise<Response> {
  const body: any = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const ip = clientIp(request);
  const device = request.headers.get('User-Agent') || 'unknown';

  /* Returns the KDF salt the client needs before it can derive anything.
     An unknown email gets a stable salt derived from a server secret instead —
     indistinguishable from a real one, and unique per address, so it becomes
     that account's real salt if the person goes on to register.

     Nothing else is returned. An `exists` flag here would hand anyone a
     rate-limited but perfectly usable "is this person a user?" oracle, which is
     exactly what the decoy exists to prevent. */
  if (path === '/auth/salt') {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!await allow(env, 'salt', ip, 60, 60_000)) return json({ error: 'Slow down and try again shortly.' }, 429);

    const account = await findAccount(env, email);
    return json({ kdfSalt: account?.kdf_salt ?? await hmac(env.SALT_PEPPER, `decoy:${email}`) });
  }

  /* Register with email + password. The password itself never arrives here:
     the client sends authHash = PBKDF2(PBKDF2(password, kdfSalt), password). */
  if (path === '/auth/register') {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (typeof body.authHash !== 'string' || body.authHash.length < 32 || body.authHash.length > 200) {
      return json({ error: 'Malformed credentials.' }, 400);
    }
    if (typeof body.kdfSalt !== 'string' || body.kdfSalt.length < 16 || body.kdfSalt.length > 100) {
      return json({ error: 'Malformed credentials.' }, 400);
    }
    if (!await allow(env, 'register', ip, 10, 60 * 60_000)) return json({ error: 'Too many sign-ups from here. Try again later.' }, 429);
    if (!await allow(env, 'mail', email, 5, 60 * 60_000)) return json({ error: 'Too many emails sent to that address. Try again in an hour.' }, 429);

    const existing = await findAccount(env, email);
    if (existing?.password_hash) {
      // Verified account with a password already exists. Say so plainly: the
      // email is already public knowledge to whoever owns that inbox, and a
      // vague error here just traps people who forgot they signed up.
      return json({ error: 'That email already has an account. Sign in instead.' }, 409);
    }

    const salt = randomToken(16);
    const hash = await pbkdf2(body.authHash, salt, PASSWORD_HASH_ROUNDS);
    const now = Date.now();

    if (existing) {
      // Google-first account adding a password. Keep the existing kdf_salt:
      // changing it would orphan every byte already encrypted under it.
      await env.DB.prepare('UPDATE accounts SET password_hash = ?, password_salt = ? WHERE user_id = ?')
        .bind(hash, salt, existing.user_id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO accounts (user_id, email, email_verified, password_hash, password_salt, kdf_salt, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), email, hash, salt, body.kdfSalt, now).run();
    }

    const code = await issueCode(env, email, 'verify');
    await sendCode(env, email, code, 'verify');
    return json({
      status: 'verification_sent',
      email,
      ...(env.DEV_ECHO_CODES === '1' ? { devCode: code } : {}),
    });
  }

  /* Confirms the emailed code and activates the account. */
  if (path === '/auth/verify') {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!await allow(env, 'verify', ip, 30, 60 * 60_000)) return json({ error: 'Too many attempts. Try again later.' }, 429);

    await consumeCode(env, email, 'verify', body.code);
    const account = await findAccount(env, email);
    if (!account) return json({ error: 'That account no longer exists.' }, 404);

    await env.DB.prepare('UPDATE accounts SET email_verified = 1, last_login_at = ? WHERE user_id = ?')
      .bind(Date.now(), account.user_id).run();

    const session = await createSession(env, account.user_id, device);
    return json({ ...session, ...identityPayload({ ...account, email_verified: 1 }) });
  }

  /* Re-sends a verification code. */
  if (path === '/auth/resend') {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!await allow(env, 'mail', email, 5, 60 * 60_000)) return json({ error: 'Too many emails sent to that address. Try again in an hour.' }, 429);

    const account = await findAccount(env, email);
    // Silence for unknown or already-verified addresses — this endpoint must
    // not become a way to test which emails are registered.
    if (account && account.email_verified !== 1) {
      const code = await issueCode(env, email, 'verify');
      await sendCode(env, email, code, 'verify');
      return json({ status: 'sent', ...(env.DEV_ECHO_CODES === '1' ? { devCode: code } : {}) });
    }
    return json({ status: 'sent' });
  }

  /* Password sign-in. */
  if (path === '/auth/login') {
    const email = normalizeEmail(body.email);
    if (!email || typeof body.authHash !== 'string') return json({ error: 'Enter your email and password.' }, 400);
    if (!await allow(env, 'login', email, 10, 15 * 60_000)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
    if (!await allow(env, 'login-ip', ip, 50, 15 * 60_000)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);

    const account = await findAccount(env, email);
    // Same work and the same message whether the account exists or the password
    // is wrong: a faster "no such user" is an enumeration oracle.
    const salt = account?.password_salt ?? 'decoy';
    const expected = account?.password_hash ?? await hmac(env.SALT_PEPPER, `nopass:${email}`);
    const candidate = await pbkdf2(body.authHash, salt, PASSWORD_HASH_ROUNDS);
    if (!account?.password_hash || !timingSafeEqual(expected, candidate)) {
      return json({ error: 'Wrong email or password.' }, 401);
    }

    if (account.email_verified !== 1) {
      const code = await issueCode(env, email, 'verify');
      await sendCode(env, email, code, 'verify');
      return json({ error: 'Verify your email first — we just sent you a new code.', status: 'verification_sent', email }, 403);
    }

    await env.DB.prepare('UPDATE accounts SET last_login_at = ? WHERE user_id = ?').bind(Date.now(), account.user_id).run();
    const session = await createSession(env, account.user_id, device);
    return json({ ...session, ...identityPayload(account) });
  }

  /* Passwordless sign-in: send a code to the address. */
  if (path === '/auth/otp/request') {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!await allow(env, 'mail', email, 5, 60 * 60_000)) return json({ error: 'Too many emails sent to that address. Try again in an hour.' }, 429);
    if (!await allow(env, 'otp-ip', ip, 20, 60 * 60_000)) return json({ error: 'Too many requests. Try again later.' }, 429);

    let account = await findAccount(env, email);
    if (!account) {
      // Code-only sign-up: receiving the code *is* the verification, so the
      // account is created up front with no password and no unverified limbo.
      const userId = crypto.randomUUID();
      const kdfSalt = typeof body.kdfSalt === 'string' && body.kdfSalt.length >= 16 ? body.kdfSalt : randomToken(16);
      await env.DB.prepare(
        'INSERT INTO accounts (user_id, email, email_verified, kdf_salt, created_at) VALUES (?, ?, 0, ?, ?)',
      ).bind(userId, email, kdfSalt, Date.now()).run();
      account = await findAccount(env, email);
    }

    const code = await issueCode(env, email, 'login');
    await sendCode(env, email, code, 'login');
    return json({ status: 'sent', email, ...(env.DEV_ECHO_CODES === '1' ? { devCode: code } : {}) });
  }

  /* Passwordless sign-in: redeem the code. */
  if (path === '/auth/otp/verify') {
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'Enter a valid email address.' }, 400);
    if (!await allow(env, 'otp-verify', ip, 30, 60 * 60_000)) return json({ error: 'Too many attempts. Try again later.' }, 429);

    await consumeCode(env, email, 'login', body.code);
    const account = await findAccount(env, email);
    if (!account) return json({ error: 'That account no longer exists.' }, 404);

    // Holding the code proves control of the inbox, which is exactly what
    // verification means.
    await env.DB.prepare('UPDATE accounts SET email_verified = 1, last_login_at = ? WHERE user_id = ?')
      .bind(Date.now(), account.user_id).run();

    const session = await createSession(env, account.user_id, device);
    return json({ ...session, ...identityPayload({ ...account, email_verified: 1 }) });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/health') return json({ ok: true, emailConfigured: Boolean(env.RESEND_API_KEY && env.MAIL_FROM) });

      if (path.startsWith('/auth/')) {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        if (!env.SALT_PEPPER) return json({ error: 'Server is misconfigured: SALT_PEPPER is not set.' }, 500);
        return await handleAuth(path, request, env);
      }

      /* Everything below needs an identity. */
      const identity = await authenticate(request, env);
      if (!identity) return json({ error: 'Unauthorized' }, 401);

      if (path === '/me') {
        const account = await findAccount(env, identity.email);
        if (!account) return json({ error: 'Account not found' }, 404);
        const devices = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?')
          .bind(identity.userId, Date.now()).first<{ n: number }>();
        return json({ ...identityPayload(account), devices: devices?.n ?? 1 });
      }

      if (path === '/logout') {
        const token = (request.headers.get('Authorization') || '').slice(7).trim();
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
        return json({ ok: true });
      }

      /* Signs this device out everywhere — the "I lost a laptop" button. */
      if (path === '/logout-all') {
        await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(identity.userId).run();
        return json({ ok: true });
      }

      if (path === '/account' && request.method === 'DELETE') {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM vaults WHERE user_id = ?').bind(identity.userId),
          env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(identity.userId),
          env.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(identity.email),
          env.DB.prepare('DELETE FROM accounts WHERE user_id = ?').bind(identity.userId),
        ]);
        return json({ deleted: true });
      }

      if (path === '/sync') {
        if (!identity.verified) return json({ error: 'Verify your email before syncing.' }, 403);

        if (request.method === 'GET') {
          const row = await env.DB.prepare('SELECT blob, updated_at FROM vaults WHERE user_id = ?')
            .bind(identity.userId).first<{ blob: string; updated_at: number }>();
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

          // Conflict guard. The client merges rather than overwriting, so a 409
          // means "you did not see the newest copy" — it re-pulls, merges, retries.
          const existing = await env.DB.prepare('SELECT updated_at FROM vaults WHERE user_id = ?')
            .bind(identity.userId).first<{ updated_at: number }>();
          if (existing && existing.updated_at > Number(body.baseUpdatedAt ?? 0)) {
            return json({ error: 'Server copy is newer', updatedAt: existing.updated_at }, 409);
          }

          const updatedAt = Date.now();
          await env.DB.prepare(
            `INSERT INTO vaults (user_id, blob, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at`,
          ).bind(identity.userId, serialized, updatedAt).run();
          return json({ updatedAt });
        }

        if (request.method === 'DELETE') {
          await env.DB.prepare('DELETE FROM vaults WHERE user_id = ?').bind(identity.userId).run();
          return json({ deleted: true });
        }

        return json({ error: 'Method not allowed' }, 405);
      }

      return json({ error: 'Not found' }, 404);
    } catch (err: any) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('Unhandled error', err?.stack || err);
      // Never echo an internal error to the client — stack traces and SQL
      // fragments are reconnaissance.
      return json({ error: 'Something went wrong on our side. Try again.' }, 500);
    }
  },
};
