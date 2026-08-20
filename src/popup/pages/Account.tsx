import React, { useState, useEffect } from 'react';
import {
  Cloud, CloudOff, LogOut, RefreshCw, ShieldCheck, AlertTriangle, Mail,
  Download, Upload, Trash2, Eye, EyeOff, KeyRound, Check, ArrowLeft,
  Laptop, Lock, Database,
} from 'lucide-react';
import type { AuthState, SyncState } from '../../shared/types';
import { SYNC_CONFIGURED, GOOGLE_CLIENT_ID } from '../../shared/config';
import {
  getAuthState, isUnlocked, unlockWithSecret, signInWithGoogle, registerWithPassword,
  verifyEmail, resendVerification, signInWithPassword, requestLoginCode, signInWithCode,
  signOut, signOutEverywhere, deleteAccount, refreshIdentity, passwordProblem, MIN_PASSWORD,
} from '../../shared/auth';
import { getSyncState, syncNow, forcePush, forcePull, deleteRemote, remoteBackupExists } from '../../shared/sync';

type Screen = 'signedOut' | 'password' | 'code' | 'verify' | 'unlock' | 'account';

export default function AccountPage() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [sync, setSync] = useState<SyncState | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [screen, setScreen] = useState<Screen>('signedOut');
  const [loading, setLoading] = useState(true);

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [confirmSecret, setConfirmSecret] = useState('');
  // null while unknown. When false, the passphrase typed below *becomes* the
  // passphrase, so it has to be confirmed — there is no recovering from a typo.
  const [hasBackup, setHasBackup] = useState<boolean | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const [a, s, u] = await Promise.all([getAuthState(), getSyncState(), isUnlocked()]);
    setAuth(a); setSync(s); setUnlocked(u);
    if (!a) setScreen('signedOut');
    else if (!a.verified) { setEmail(a.email); setScreen('verify'); }
    else if (!u) {
      setScreen('unlock');
      // Only matters for accounts with no password to derive from.
      if (a.method !== 'password') remoteBackupExists().then(setHasBackup).catch(() => setHasBackup(null));
      else setHasBackup(true);
    }
    else setScreen('account');
    setLoading(false);
  };

  useEffect(() => { refresh(); }, []);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setError(null); setStatus(null);
    try {
      const message = await fn();
      await refresh();
      if (message) setStatus(message);
    } catch (err: any) {
      setError(err?.message || `${label} failed.`);
      if (err?.needsVerification) { setScreen('verify'); }
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-7 h-7 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" /></div>;
  }

  if (!SYNC_CONFIGURED) return <NotConfigured />;

  const Banner = () => (
    <>
      {status && (
        <div className="p-2.5 bg-green-500/10 border border-green-500/30 rounded-xl text-[11px] text-green-300 flex items-start gap-2">
          <Check size={12} className="shrink-0 mt-0.5" /> <span>{status}</span>
        </div>
      )}
      {error && (
        <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-xl text-[11px] text-red-300 break-words flex items-start gap-2">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> <span>{error}</span>
        </div>
      )}
    </>
  );

  /* ─── Signed out: pick a way in ─── */
  if (screen === 'signedOut') {
    return (
      <div className="flex flex-col h-full gap-4 overflow-y-auto pr-1 pb-4">
        <Header title="Sync across devices" subtitle="Sign in once on each laptop and everything follows you." />

        {GOOGLE_CLIENT_ID && (
          <button
            className="btn-secondary w-full !py-3 !text-[13px] font-semibold"
            disabled={Boolean(busy)}
            onClick={() => run('Google sign-in', async () => { await signInWithGoogle(); return 'Signed in with Google.'; })}
          >
            <GoogleMark /> {busy === 'Google sign-in' ? 'Opening Google…' : 'Continue with Google'}
          </button>
        )}

        {GOOGLE_CLIENT_ID && (
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[#27272a]" />
            <span className="text-[10px] uppercase tracking-wider text-muted-dark">or</span>
            <div className="h-px flex-1 bg-[#27272a]" />
          </div>
        )}

        <button className="btn-secondary w-full !py-3 !text-[13px]" onClick={() => { setIsRegistering(false); setScreen('password'); setError(null); }}>
          <Mail size={15} /> Continue with email
        </button>

        <StorageExplainer />
        <Banner />
      </div>
    );
  }

  /* ─── Email + password ─── */
  if (screen === 'password') {
    const problem = isRegistering && password ? passwordProblem(password) : null;
    return (
      <div className="flex flex-col h-full gap-3 overflow-y-auto pr-1 pb-4">
        <BackTo onClick={() => { setScreen('signedOut'); setError(null); }} />
        <Header
          title={isRegistering ? 'Create your account' : 'Sign in'}
          subtitle={isRegistering ? 'Your password also unlocks your data — we never see either.' : 'Same email and password you used on your other laptop.'}
        />

        <Field label="Email">
          <input className="glass-input" type="email" autoComplete="username" placeholder="you@example.com"
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="Password" hint={isRegistering ? `At least ${MIN_PASSWORD} characters` : undefined}>
          <div className="relative">
            <input className="glass-input !pr-9" type={showSecret ? 'text' : 'password'}
                   autoComplete={isRegistering ? 'new-password' : 'current-password'}
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitPassword(); }} />
            <RevealButton on={showSecret} toggle={() => setShowSecret((v) => !v)} />
          </div>
          {problem && <p className="text-[11px] text-amber-400 mt-1">{problem}</p>}
        </Field>

        {isRegistering && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl">
            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-muted-light leading-relaxed">
              This password is the only key to your synced data. We cannot reset it — if you forget it,
              the encrypted copy on the server is unreadable to everyone, us included.
            </p>
          </div>
        )}

        <button className="btn-primary w-full !py-3" disabled={Boolean(busy) || !email || !password} onClick={submitPassword}>
          {busy ? 'Working…' : isRegistering ? 'Create account' : 'Sign in'}
        </button>

        <button className="text-[11px] text-primary-400 hover:underline self-center"
                onClick={() => { setIsRegistering((v) => !v); setError(null); }}>
          {isRegistering ? 'I already have an account' : 'Create a new account'}
        </button>

        <div className="flex items-center gap-3 my-1">
          <div className="h-px flex-1 bg-[#27272a]" />
          <span className="text-[10px] uppercase tracking-wider text-muted-dark">or</span>
          <div className="h-px flex-1 bg-[#27272a]" />
        </div>

        <button className="btn-ghost !text-[12px]" onClick={() => { setScreen('code'); setError(null); }}>
          <KeyRound size={13} /> Email me a code instead
        </button>

        <Banner />
      </div>
    );
  }

  /* ─── Passwordless code ─── */
  if (screen === 'code') {
    return (
      <div className="flex flex-col h-full gap-3 overflow-y-auto pr-1 pb-4">
        <BackTo onClick={() => { setScreen('password'); setError(null); setCode(''); }} />
        <Header title="Sign in with a code" subtitle="We'll email you a 6-digit code. No password needed." />

        <Field label="Email">
          <input className="glass-input" type="email" autoComplete="username" placeholder="you@example.com"
                 value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <button className="btn-secondary w-full !py-2.5 !text-[13px]" disabled={Boolean(busy) || !email}
                onClick={() => run('Send code', async () => {
                  const { devCode } = await requestLoginCode(email.trim());
                  return devCode ? `Dev mode — your code is ${devCode}` : `Code sent to ${email.trim()}.`;
                })}>
          <Mail size={14} /> {busy === 'Send code' ? 'Sending…' : 'Send me a code'}
        </button>

        <Field label="6-digit code">
          <input className="glass-input text-center tracking-[0.4em] font-mono text-lg" inputMode="numeric"
                 maxLength={6} placeholder="000000" autoComplete="one-time-code"
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                 onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) submitCode(); }} />
        </Field>

        <button className="btn-primary w-full !py-3" disabled={Boolean(busy) || code.length !== 6} onClick={submitCode}>
          {busy === 'Sign in' ? 'Signing in…' : 'Sign in'}
        </button>

        <Banner />
      </div>
    );
  }

  /* ─── Verify a new email ─── */
  if (screen === 'verify') {
    return (
      <div className="flex flex-col h-full gap-3 overflow-y-auto pr-1 pb-4">
        <Header title="Check your email" subtitle={`We sent a 6-digit code to ${auth?.email || email}.`} />

        <Field label="Verification code">
          <input className="glass-input text-center tracking-[0.4em] font-mono text-lg" inputMode="numeric"
                 maxLength={6} placeholder="000000" autoComplete="one-time-code"
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                 onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) submitVerify(); }} />
        </Field>

        <button className="btn-primary w-full !py-3" disabled={Boolean(busy) || code.length !== 6} onClick={submitVerify}>
          {busy === 'Verify' ? 'Verifying…' : 'Verify and continue'}
        </button>

        <div className="flex items-center justify-between">
          <button className="text-[11px] text-primary-400 hover:underline" disabled={Boolean(busy)}
                  onClick={() => run('Resend', async () => {
                    const { devCode } = await resendVerification(auth?.email || email);
                    return devCode ? `Dev mode — your code is ${devCode}` : 'A new code is on its way.';
                  })}>
            Send a new code
          </button>
          <button className="text-[11px] text-muted hover:text-muted-light"
                  onClick={() => run('Sign out', async () => { await signOut(); setCode(''); setPassword(''); })}>
            Use a different email
          </button>
        </div>

        <p className="text-[11px] text-muted leading-relaxed">
          Nothing in your inbox? Check spam, and make sure the address above is right. Codes expire after 10 minutes.
        </p>

        <Banner />
      </div>
    );
  }

  /* ─── Locked: derive the key for this browser session ─── */
  if (screen === 'unlock') {
    const isPasswordAccount = auth?.method === 'password';
    const isSettingNew = !isPasswordAccount && hasBackup === false;
    const mismatch = isSettingNew && confirmSecret.length > 0 && confirmSecret !== password;
    const canUnlock = password.length >= MIN_PASSWORD && (!isSettingNew || confirmSecret === password);
    return (
      <div className="flex flex-col h-full gap-3 overflow-y-auto pr-1 pb-4">
        <Header
          title={isSettingNew ? 'Choose an encryption passphrase' : 'Unlock your data'}
          subtitle={isPasswordAccount
            ? 'Enter your account password to decrypt this device.'
            : isSettingNew
              ? 'This encrypts everything before it leaves your device. You will type it once on each machine.'
              : 'Enter the passphrase that encrypts your data.'}
        />

        <div className="glass-card-static p-3 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary-500/15 text-primary-400 flex items-center justify-center shrink-0">
            <Cloud size={15} />
          </div>
          <p className="text-[13px] font-medium truncate">{auth?.email}</p>
        </div>

        <Field label={isPasswordAccount ? 'Password' : 'Encryption passphrase'}
               hint={isPasswordAccount ? undefined : `At least ${MIN_PASSWORD} characters. Same one on every device.`}>
          <div className="relative">
            <input className="glass-input !pr-9" type={showSecret ? 'text' : 'password'} autoComplete="current-password"
                   value={password} onChange={(e) => setPassword(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') submitUnlock(); }} />
            <RevealButton on={showSecret} toggle={() => setShowSecret((v) => !v)} />
          </div>
        </Field>

        {isSettingNew && (
          <>
            <Field label="Confirm passphrase">
              <input className="glass-input" type={showSecret ? 'text' : 'password'} autoComplete="new-password"
                     value={confirmSecret} onChange={(e) => setConfirmSecret(e.target.value)}
                     onKeyDown={(e) => { if (e.key === 'Enter' && canUnlock) submitUnlock(); }} />
              {mismatch && <p className="text-[11px] text-amber-400 mt-1">These don't match.</p>}
            </Field>
            <div className="flex items-start gap-2 p-2.5 bg-amber-500/5 border border-amber-500/20 rounded-xl">
              <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-light leading-relaxed">
                Write this down somewhere safe. It never reaches our server, so nobody can reset it — if it
                is lost, your synced data stays encrypted forever.
              </p>
            </div>
          </>
        )}

        <button className="btn-primary w-full !py-3" disabled={Boolean(busy) || !canUnlock} onClick={submitUnlock}>
          <Lock size={14} /> {busy === 'Unlock' ? 'Deriving key…' : isSettingNew ? 'Set passphrase' : 'Unlock'}
        </button>

        <p className="text-[11px] text-muted leading-relaxed">
          The key is derived here and held in memory only — it is wiped when you close the browser, and it
          never reaches the server.
        </p>

        <button className="btn-ghost !text-[11px] self-start" onClick={() => run('Sign out', async () => { await signOut(); setPassword(''); })}>
          <LogOut size={12} /> Sign out
        </button>

        <Banner />
      </div>
    );
  }

  /* ─── Signed in and unlocked ─── */
  const pending = Boolean(sync?.pendingSince);
  return (
    <div className="flex flex-col h-full gap-3 overflow-y-auto pr-1 pb-4">
      <div className="glass-card-static p-3.5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-500/15 text-primary-400 flex items-center justify-center shrink-0">
            <Cloud size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold truncate">{auth?.email}</p>
            <p className="text-[11px] text-muted flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 text-green-400"><ShieldCheck size={10} /> Verified</span>
              <span>·</span>
              <span>{auth?.method === 'google' ? 'Google' : auth?.method === 'otp' ? 'Email code' : 'Password'}</span>
            </p>
          </div>
        </div>

        <div className="h-px bg-[#27272a]" />

        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted flex items-center gap-1.5">
            <Laptop size={11} /> {auth?.devices ?? 1} device{(auth?.devices ?? 1) === 1 ? '' : 's'} signed in
          </span>
          <span className={pending ? 'text-amber-400' : 'text-muted'}>
            {pending ? 'Changes pending…'
              : sync?.lastSyncedAt ? `Synced ${relativeTime(sync.lastSyncedAt)}`
              : 'Not synced yet'}
          </span>
        </div>

        {sync?.lastError && (
          <p className="text-[11px] text-amber-400 leading-relaxed">Last automatic sync failed: {sync.lastError}</p>
        )}
      </div>

      <div className="glass-card-static p-3 flex items-start gap-2.5">
        <RefreshCw size={14} className="text-primary-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-light leading-relaxed">
          Syncing runs on its own — every few minutes, and shortly after you change anything. Open FormPilot
          on your other laptop and it catches up by itself.
        </p>
      </div>

      <button className="btn-primary w-full !py-3" disabled={Boolean(busy)}
              onClick={() => run('Sync', async () => { await syncNow(); return 'Everything is up to date.'; })}>
        <RefreshCw size={15} className={busy === 'Sync' ? 'animate-spin' : ''} />
        {busy === 'Sync' ? 'Syncing…' : 'Sync now'}
      </button>

      <StorageExplainer />

      <details className="glass-card-static p-3">
        <summary className="text-[12px] font-semibold cursor-pointer select-none">Advanced</summary>
        <div className="mt-3 space-y-2">
          <p className="text-[11px] text-muted leading-relaxed">
            Normal syncing merges both devices. These two throw one side away — only reach for them if a
            device is holding data you know is wrong.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary !py-2 !text-[11px]" disabled={Boolean(busy)}
                    onClick={() => { if (confirm('Overwrite the server with this device’s data?')) run('Push', async () => { await forcePush(); return 'Server replaced with this device.'; }); }}>
              <Upload size={12} /> Force push
            </button>
            <button className="btn-secondary !py-2 !text-[11px]" disabled={Boolean(busy)}
                    onClick={() => { if (confirm('Replace this device’s data with the server copy?')) run('Pull', async () => { const r = await forcePull(); return r ? 'This device replaced with the server copy.' : 'Nothing stored on the server yet.'; }); }}>
              <Download size={12} /> Force pull
            </button>
          </div>

          <div className="h-px bg-[#27272a] my-1" />

          <button className="btn-ghost !text-[11px] w-full !justify-start" disabled={Boolean(busy)}
                  onClick={() => { if (confirm('Sign out on every device? You will need to sign in again everywhere.')) run('Sign out all', async () => { await signOutEverywhere(); return 'Signed out everywhere.'; }); }}>
            <LogOut size={12} /> Sign out on all devices
          </button>
          <button className="btn-ghost !text-[11px] w-full !justify-start text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                  disabled={Boolean(busy)}
                  onClick={() => { if (confirm('Delete the encrypted copy from the server? Data on this device is kept.')) run('Delete backup', async () => { await deleteRemote(); return 'Server copy deleted.'; }); }}>
            <Trash2 size={12} /> Delete server copy
          </button>
          <button className="btn-ghost !text-[11px] w-full !justify-start text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  disabled={Boolean(busy)}
                  onClick={() => { if (confirm('Delete your account and everything stored on the server? This cannot be undone.')) run('Delete account', async () => { await deleteAccount(); return 'Account deleted.'; }); }}>
            <Trash2 size={12} /> Delete my account
          </button>
        </div>
      </details>

      <div className="flex items-center justify-between">
        <button className="btn-ghost !text-[11px]" onClick={() => run('Sign out', async () => { await signOut(); setPassword(''); return 'Signed out on this device.'; })}>
          <LogOut size={12} /> Sign out
        </button>
        <button className="btn-ghost !text-[11px]" disabled={Boolean(busy)}
                onClick={() => run('Refresh', async () => { await refreshIdentity(); })}>
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      <Banner />
    </div>
  );

  /* ─── Submit handlers ─── */
  function submitPassword() {
    const address = email.trim();
    if (isRegistering) {
      run('Create account', async () => {
        const { devCode } = await registerWithPassword(address, password);
        setScreen('verify');
        return devCode ? `Dev mode — your code is ${devCode}` : `We sent a verification code to ${address}.`;
      });
    } else {
      run('Sign in', async () => { await signInWithPassword(address, password); return 'Signed in.'; });
    }
  }

  function submitCode() {
    run('Sign in', async () => { await signInWithCode(email.trim(), code); setCode(''); return 'Signed in.'; });
  }

  function submitVerify() {
    run('Verify', async () => {
      await verifyEmail(auth?.email || email.trim(), code, password || undefined);
      setCode('');
      return 'Email verified.';
    });
  }

  function submitUnlock() {
    run('Unlock', async () => {
      await unlockWithSecret(password);
      setPassword('');
      setConfirmSecret('');
      // Getting the key back is exactly when the queued changes can finally go up.
      await syncNow().catch(() => {});
      return 'Unlocked and syncing.';
    });
  }
}

/* ─── Presentational bits ─── */

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-1">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="text-[12px] text-muted-light leading-relaxed">{subtitle}</p>
    </div>
  );
}

function BackTo({ onClick }: { onClick: () => void }) {
  return (
    <button className="btn-ghost !px-1 !text-[11px] self-start" onClick={onClick}>
      <ArrowLeft size={12} /> Back
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-muted-light">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function RevealButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white p-1"
            onClick={toggle} title={on ? 'Hide' : 'Show'} type="button">
      {on ? <EyeOff size={14} /> : <Eye size={14} />}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l6.9 5.4c4.1-3.8 6.6-9.4 6.6-15.7z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z" />
      <path fill="#EA4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14.1l7.1 5.5c1.8-5.3 6.7-9.1 12.5-9.1z" />
    </svg>
  );
}

/* Answers the question every user actually has: where does my stuff live? */
function StorageExplainer() {
  return (
    <div className="glass-card-static p-3 space-y-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-light flex items-center gap-1.5">
        <Database size={11} /> Where your data lives
      </p>
      <ul className="space-y-1.5 text-[11px] text-muted-light leading-relaxed">
        <li className="flex gap-2">
          <span className="text-primary-400 shrink-0">•</span>
          <span><strong className="text-white">On this device</strong> — profiles, memory, cards and passwords sit in the extension's own storage, readable by nothing else on your machine.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-primary-400 shrink-0">•</span>
          <span><strong className="text-white">On the server</strong> — one AES-256-GCM blob and your email. Cards, passwords and memory are inside that blob, encrypted before they leave.</span>
        </li>
        <li className="flex gap-2">
          <span className="text-primary-400 shrink-0">•</span>
          <span><strong className="text-white">The key</strong> — derived from your password on this device, held in memory for the browser session. It is never uploaded, so nobody at the other end can open the blob.</span>
        </li>
      </ul>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="flex flex-col h-full gap-3 pt-1">
      <h2 className="text-xl font-bold tracking-tight">Account &amp; Sync</h2>
      <div className="glass-card-static p-4 space-y-2 border-amber-500/30">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertTriangle size={16} />
          <span className="text-sm font-semibold">Sync isn't set up yet</span>
        </div>
        <p className="text-[11px] text-muted-light leading-relaxed">
          Deploy the Worker in <code className="text-primary-400">worker/</code>, then fill in
          <code className="text-primary-400"> SYNC_API_URL</code> (and
          <code className="text-primary-400"> GOOGLE_CLIENT_ID</code> for Google sign-in) in
          <code className="text-primary-400"> src/shared/config.ts</code> and rebuild.
        </p>
        <p className="text-[11px] text-muted-light">
          Step-by-step: <code className="text-primary-400">docs/sync-setup.md</code>
        </p>
      </div>
      <div className="glass-card-static p-3">
        <p className="text-[11px] text-muted-light leading-relaxed">
          Until then everything stays on this device only — nothing is uploaded anywhere.
        </p>
      </div>
    </div>
  );
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
