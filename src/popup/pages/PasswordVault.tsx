import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, Copy, Eye, EyeOff, RefreshCw, Search, Key, ChevronDown, ChevronUp, Check } from 'lucide-react';
import type { PasswordEntry, Page } from '../../shared/types';
import { getPasswords, addPassword, deletePassword, updatePassword, generateId } from '../../shared/storage';

interface PasswordVaultProps {
  navigateTo: (page: Page) => void;
}

// ─── Secure password generator (crypto.getRandomValues — no API call) ───
function generateSecurePassword(length: number, upper: boolean, lower: boolean, nums: boolean, syms: boolean): string {
  const charset = [
    upper ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '',
    lower ? 'abcdefghijklmnopqrstuvwxyz' : '',
    nums  ? '0123456789' : '',
    syms  ? '!@#$%^&*()_+-=[]{}|;:,.<>?' : '',
  ].join('');
  if (!charset) return '';
  const buf = new Uint32Array(length);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => charset[n % charset.length]).join('');
}

function groupByDomain(entries: PasswordEntry[]): Record<string, PasswordEntry[]> {
  return entries.reduce<Record<string, PasswordEntry[]>>((acc, e) => {
    (acc[e.domain] ??= []).push(e);
    return acc;
  }, {});
}

// Strip protocol + path so pasted URLs become plain hostnames
function normalizeDomain(value: string): string {
  try { return new URL(value.includes('://') ? value : `https://${value}`).hostname; } catch { return value; }
}

const EMPTY_FORM = { domain: '', username: '', password: '', label: '' };

// Stable per-domain colour, computed locally.
function domainHue(domain: string): number {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) hash = (hash * 31 + domain.charCodeAt(i)) % 360;
  return hash;
}

export default function PasswordVault({ navigateTo }: PasswordVaultProps) {
  const [entries, setEntries]                 = useState<PasswordEntry[]>([]);
  const [isLoading, setIsLoading]             = useState(true);
  const [search, setSearch]                   = useState('');
  const [showForm, setShowForm]               = useState(false);
  const [editingId, setEditingId]             = useState<string | null>(null);
  const [form, setForm]                       = useState(EMPTY_FORM);
  const [showFormPw, setShowFormPw]           = useState(false);
  const [visiblePws, setVisiblePws]           = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId]               = useState<string | null>(null);
  const [isSaving, setIsSaving]               = useState(false);

  // Generator
  const [showGen, setShowGen]   = useState(false);
  const [genLen, setGenLen]     = useState(16);
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genNums, setGenNums]   = useState(true);
  const [genSyms, setGenSyms]   = useState(true);
  const [genPw, setGenPw]       = useState('');

  useEffect(() => {
    getPasswords().then(e => { setEntries(e); setIsLoading(false); });
  }, []);

  const regenerate = useCallback(() => {
    setGenPw(generateSecurePassword(genLen, genUpper, genLower, genNums, genSyms));
  }, [genLen, genUpper, genLower, genNums, genSyms]);

  useEffect(() => { if (showGen) regenerate(); }, [showGen, regenerate]);

  const copyToClipboard = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleSave = async () => {
    if (!form.domain.trim() || !form.username.trim() || !form.password.trim()) return;
    setIsSaving(true);
    const domain = normalizeDomain(form.domain);
    if (editingId) {
      await updatePassword(editingId, { domain, username: form.username, password: form.password, label: form.label || undefined });
      setEntries(prev => prev.map(e => e.id === editingId ? { ...e, domain, username: form.username, password: form.password, label: form.label || undefined, updatedAt: Date.now() } : e));
    } else {
      const entry: PasswordEntry = {
        id: generateId(),
        domain,
        username: form.username,
        password: form.password,
        label: form.label || undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await addPassword(entry);
      setEntries(prev => [...prev, entry]);
    }
    setIsSaving(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    await deletePassword(id);
    setEntries(prev => prev.filter(e => e.id !== id));
  };

  const startEdit = (entry: PasswordEntry) => {
    setForm({ domain: entry.domain, username: entry.username, password: entry.password, label: entry.label || '' });
    setEditingId(entry.id);
    setShowFormPw(false);
    setShowForm(true);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setShowFormPw(false);
  };

  const togglePwVisible = (id: string) =>
    setVisiblePws(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const f = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const filtered = search
    ? entries.filter(e => e.domain.includes(search) || e.username.includes(search) || (e.label || '').includes(search))
    : entries;
  const grouped = groupByDomain(filtered);
  const domains = Object.keys(grouped).sort();

  if (isLoading) return <div className="p-4"><div className="shimmer h-12 w-full rounded-xl"></div></div>;

  return (
    <div className="flex flex-col h-full space-y-4 pt-1 pb-6 overflow-y-auto pr-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Passwords</h2>
          <button
            className="text-[10px] text-primary-400 hover:underline mt-0.5"
            onClick={() => navigateTo('paymentVault')}
          >
            Switch to Payment Cards →
          </button>
        </div>
        {!showForm && (
          <button className="btn-secondary !py-1.5 !px-3" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Add
          </button>
        )}
      </div>

      {/* Password Generator */}
      <div className="glass-card-static rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between p-3 bg-[#0D1829]/50"
          onClick={() => setShowGen(v => !v)}
        >
          <div className="flex items-center gap-2">
            <Key size={14} className="text-primary-400" />
            <span className="font-semibold text-sm">Password Generator</span>
          </div>
          {showGen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        {showGen && (
          <div className="p-3 border-t border-[rgba(255,255,255,0.09)] space-y-3 animate-slide-up">
            {/* Generated password display */}
            <div className="flex items-center gap-2 bg-[#080F1E] rounded-lg p-2.5 border border-[rgba(255,255,255,0.09)]">
              <span className="flex-1 font-mono text-xs text-primary-200 break-all select-all min-h-[1rem]">
                {genPw || '—'}
              </span>
              <button className="btn-ghost !p-1.5 shrink-0" title="Copy" onClick={() => genPw && copyToClipboard(genPw, 'gen')}>
                {copiedId === 'gen' ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
              </button>
              <button className="btn-ghost !p-1.5 shrink-0" title="Regenerate" onClick={regenerate}>
                <RefreshCw size={13} />
              </button>
            </div>

            {/* Length slider */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-light shrink-0 w-16">Length: {genLen}</span>
              <input
                type="range" min={8} max={64} value={genLen}
                onChange={e => setGenLen(+e.target.value)}
                className="flex-1 accent-[#0D94FB]"
              />
            </div>

            {/* Character set toggles */}
            <div className="grid grid-cols-2 gap-2">
              {([
                ['Uppercase', genUpper, setGenUpper],
                ['Lowercase', genLower, setGenLower],
                ['Numbers',   genNums,  setGenNums],
                ['Symbols',   genSyms,  setGenSyms],
              ] as [string, boolean, React.Dispatch<React.SetStateAction<boolean>>][]).map(([label, val, set]) => (
                <label key={label} className="flex items-center gap-2 cursor-pointer">
                  <div className={`toggle-track ${val ? 'active' : ''}`} onClick={() => set(v => !v)}>
                    <div className="toggle-thumb"></div>
                  </div>
                  <span className="text-xs text-muted-light">{label}</span>
                </label>
              ))}
            </div>

            {genPw && (
              <button
                className="btn-secondary w-full !py-1.5 !text-xs"
                onClick={() => { setForm(p => ({ ...p, password: genPw })); setShowForm(true); setShowFormPw(true); }}
              >
                Use this password
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="glass-card-static p-4 space-y-3 animate-slide-up">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-sm">{editingId ? 'Edit Entry' : 'New Entry'}</span>
            <button className="btn-ghost !p-1 text-lg leading-none" onClick={resetForm}>✕</button>
          </div>

          <input className="glass-input !py-1.5" placeholder="Domain (e.g. github.com)"
            value={form.domain} onChange={f('domain')} />
          <input className="glass-input !py-1.5" placeholder="Username / Email"
            value={form.username} onChange={f('username')} />

          <div className="relative">
            <input
              className="glass-input !py-1.5 !pr-10 font-mono"
              type={showFormPw ? 'text' : 'password'}
              placeholder="Password"
              value={form.password}
              onChange={f('password')}
            />
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-muted-light"
              onClick={() => setShowFormPw(v => !v)}
            >
              {showFormPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <input className="glass-input !py-1.5" placeholder="Label (optional)"
            value={form.label} onChange={f('label')} />

          <div className="flex gap-2 pt-1">
            <button
              className="btn-primary flex-1 !py-2"
              onClick={handleSave}
              disabled={isSaving || !form.domain || !form.username || !form.password}
            >
              {isSaving ? 'Saving…' : editingId ? 'Update' : 'Save'}
            </button>
            <button className="btn-secondary !py-2 !px-4" onClick={resetForm}>Cancel</button>
          </div>
        </div>
      )}

      {/* Search */}
      {entries.length > 3 && (
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="glass-input !pl-8 !py-1.5 !text-xs"
            placeholder="Search domain or username…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      {/* Entry list grouped by domain */}
      {entries.length === 0 && !showForm ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-[#0D1829]/30 rounded-2xl border border-dashed border-[rgba(255,255,255,0.09)]">
          <div className="w-12 h-12 bg-[#112035] rounded-full flex items-center justify-center text-muted mb-3">
            <Key size={20} />
          </div>
          <h3 className="font-semibold mb-1">No passwords saved</h3>
          <p className="text-xs text-muted-light">Add credentials to auto-fill login forms.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {domains.map(domain => (
            <div key={domain}>
              <div className="flex items-center gap-2 mb-2">
                {/* Local dot, not a remote favicon: asking an external service
                    for an icon would tell it every site you hold an account on. */}
                <span
                  className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold uppercase shrink-0"
                  style={{ backgroundColor: `hsl(${domainHue(domain)} 60% 22%)`, color: `hsl(${domainHue(domain)} 70% 70%)` }}
                >
                  {domain.replace(/^www\./, '').charAt(0) || '?'}
                </span>
                <span className="text-[10px] font-bold text-muted-light uppercase tracking-wider">{domain}</span>
              </div>
              <div className="space-y-2">
                {grouped[domain].map(entry => {
                  const pwVisible = visiblePws.has(entry.id);
                  return (
                    <div key={entry.id} className="glass-card p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{entry.username}</p>
                          {entry.label && <p className="text-[10px] text-muted">{entry.label}</p>}
                        </div>
                        <div className="flex gap-1 shrink-0 ml-2">
                          <button className="btn-ghost !p-1" title="Copy username"
                            onClick={() => copyToClipboard(entry.username, `u-${entry.id}`)}>
                            {copiedId === `u-${entry.id}`
                              ? <Check size={12} className="text-green-400" />
                              : <Copy size={12} />}
                          </button>
                          <button className="btn-ghost !p-1" title="Copy password"
                            onClick={() => copyToClipboard(entry.password, `p-${entry.id}`)}>
                            {copiedId === `p-${entry.id}`
                              ? <Check size={12} className="text-green-400" />
                              : <Key size={12} />}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted flex-1 truncate">
                          {pwVisible ? entry.password : '•'.repeat(Math.min(entry.password.length, 12))}
                        </span>
                        <button className="btn-ghost !p-1" onClick={() => togglePwVisible(entry.id)}>
                          {pwVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                        <button className="btn-ghost !p-1" onClick={() => startEdit(entry)}>
                          <Edit2 size={12} />
                        </button>
                        <button
                          className="btn-ghost !p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => handleDelete(entry.id)}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
