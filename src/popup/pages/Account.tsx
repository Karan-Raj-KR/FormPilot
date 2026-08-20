import React, { useState, useEffect } from 'react';
import {
  Cloud, CloudOff, LogIn, LogOut, RefreshCw, ShieldCheck, AlertTriangle,
  Download, Upload, Trash2, Eye, EyeOff,
} from 'lucide-react';
import type { SyncState } from '../../shared/types';
import { SYNC_CONFIGURED } from '../../shared/config';
import { getSyncState, signIn, signOut, push, pull, sync, deleteRemote } from '../../shared/sync';

const MIN_PASSPHRASE = 10;

export default function AccountPage() {
  const [state, setState] = useState<SyncState | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => { getSyncState().then(setState); }, []);

  // The passphrase is deliberately never persisted: holding it in storage would
  // put the decryption key next to the ciphertext and defeat the encryption.
  const run = async (label: string, fn: () => Promise<any>, needsPass = true) => {
    if (needsPass && passphrase.length < MIN_PASSPHRASE) {
      setError(`Passphrase must be at least ${MIN_PASSPHRASE} characters.`);
      return;
    }
    setBusy(label); setError(null); setStatus(null);
    try {
      const result = await fn();
      setState(await getSyncState());
      setStatus(typeof result === 'string' ? result : `${label} complete.`);
    } catch (err: any) {
      setError(err?.message || `${label} failed.`);
    } finally {
      setBusy(null);
    }
  };

  if (!SYNC_CONFIGURED) {
    return (
      <div className="flex flex-col h-full space-y-4 pt-1">
        <h2 className="text-xl font-bold text-white tracking-tight">Account & Sync</h2>
        <div className="glass-card-static p-4 space-y-2 border-amber-500/30">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle size={16} />
            <span className="text-sm font-semibold">Sync isn't set up yet</span>
          </div>
          <p className="text-[11px] text-muted-light leading-relaxed">
            Deploy the Worker in <code className="text-primary-400">worker/</code>, then fill in
            <code className="text-primary-400"> GOOGLE_CLIENT_ID</code> and
            <code className="text-primary-400"> SYNC_API_URL</code> in
            <code className="text-primary-400"> src/shared/config.ts</code> and rebuild.
          </p>
          <p className="text-[11px] text-muted-light">Full walkthrough: <code className="text-primary-400">docs/sync-setup.md</code></p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4 pt-1 overflow-y-auto pr-1 pb-6">
      <h2 className="text-xl font-bold text-white tracking-tight">Account & Sync</h2>

      {/* Signed-in identity */}
      <div className="glass-card-static p-4 space-y-3">
        {state?.email ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary-500/15 text-primary-400 flex items-center justify-center">
                <Cloud size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{state.email}</p>
                <p className="text-[10px] text-muted">
                  {state.lastSyncedAt
                    ? `Last synced ${new Date(state.lastSyncedAt).toLocaleString()}`
                    : 'Never synced from this device'}
                </p>
              </div>
            </div>
            <button
              className="btn-ghost !text-[10px] !py-1"
              onClick={() => run('Sign out', async () => { await signOut(); return 'Signed out.'; }, false)}
            >
              <LogOut size={12} /> Sign out
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#27272a] text-muted flex items-center justify-center">
                <CloudOff size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold">Not signed in</p>
                <p className="text-[10px] text-muted">Sign in to use FormPilot on your other machines</p>
              </div>
            </div>
            <button
              className="btn-primary w-full !py-2.5"
              disabled={busy === 'Sign in'}
              onClick={() => run('Sign in', async () => { await signIn(); return 'Signed in.'; }, false)}
            >
              <LogIn size={15} /> {busy === 'Sign in' ? 'Opening Google…' : 'Sign in with Google'}
            </button>
          </>
        )}
      </div>

      {/* Passphrase */}
      {state?.email && (
        <>
          <div className="glass-card-static p-4 space-y-2">
            <label className="text-xs text-muted-light font-medium">Encryption passphrase</label>
            <div className="relative">
              <input
                type={showPass ? 'text' : 'password'}
                className="glass-input !pr-9"
                placeholder="At least 10 characters"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
              />
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white"
                onClick={() => setShowPass((v) => !v)}
                title={showPass ? 'Hide' : 'Show'}
              >
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <div className="flex items-start gap-2 text-[10px] text-muted-light leading-relaxed pt-1">
              <ShieldCheck size={13} className="text-green-500 shrink-0 mt-0.5" />
              <span>
                Your data is encrypted on this device before upload. The server stores ciphertext it
                cannot read. <strong className="text-amber-400">If you forget this passphrase your
                synced data is unrecoverable</strong> — nobody can reset it.
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              className="btn-primary w-full !py-3"
              disabled={Boolean(busy)}
              onClick={() => run('Sync', async () => {
                const { action } = await sync(passphrase);
                return action === 'pulled' ? 'Pulled newer data from your other device.' : 'Uploaded this device’s data.';
              })}
            >
              <RefreshCw size={15} className={busy === 'Sync' ? 'animate-spin' : ''} />
              {busy === 'Sync' ? 'Syncing…' : 'Sync now'}
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                className="btn-secondary !py-2 !text-xs"
                disabled={Boolean(busy)}
                onClick={() => run('Upload', async () => { await push(passphrase); return 'This device’s data is now the server copy.'; })}
              >
                <Upload size={13} /> Push
              </button>
              <button
                className="btn-secondary !py-2 !text-xs"
                disabled={Boolean(busy)}
                onClick={() => run('Download', async () => {
                  const result = await pull(passphrase);
                  return result ? 'Replaced local data with the server copy.' : 'Nothing stored on the server yet.';
                })}
              >
                <Download size={13} /> Pull
              </button>
            </div>

            <p className="text-[10px] text-muted text-center px-2">
              Push overwrites the server. Pull overwrites this device.
            </p>
          </div>

          <button
            className="btn-ghost !text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 self-start"
            disabled={Boolean(busy)}
            onClick={() => {
              if (!confirm('Delete the encrypted copy from the server? Data on this device is kept.')) return;
              run('Delete', async () => { await deleteRemote(); return 'Server copy deleted.'; }, false);
            }}
          >
            <Trash2 size={12} /> Delete server copy
          </button>
        </>
      )}

      {status && (
        <div className="p-2.5 bg-green-500/10 border border-green-500/30 rounded-lg text-[11px] text-green-400">
          {status}
        </div>
      )}
      {error && (
        <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg text-[11px] text-red-400 break-words">
          {error}
        </div>
      )}
    </div>
  );
}
