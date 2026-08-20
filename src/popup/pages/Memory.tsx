import React, { useEffect, useMemo, useState } from 'react';
import { Brain, Trash2, Search, Globe, Sparkles, Keyboard, ShieldCheck } from 'lucide-react';
import type { MemoryFact } from '../../shared/types';
import { getMemory, saveMemory, clearMemory, forgetFact } from '../../shared/memory';

export default function MemoryPage() {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    getMemory().then((f) => {
      setFacts(f);
      setLoading(false);
    });
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return facts
      .filter((f) => !q || f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q) || f.domain.includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [facts, query]);

  const global = visible.filter((f) => !f.domain);
  const scoped = visible.filter((f) => f.domain);

  const edit = async (fact: MemoryFact, value: string) => {
    const next = facts.map((f) => (f.key === fact.key && f.domain === fact.domain ? { ...f, value, updatedAt: Date.now() } : f));
    setFacts(next);
    await saveMemory(next);
  };

  const forget = async (fact: MemoryFact) => {
    setFacts(await forgetFact(fact.key, fact.domain));
  };

  const wipe = async () => {
    if (!confirm('Forget everything FormPilot has learned? Your profiles and vault are not affected.')) return;
    await clearMemory();
    setFacts([]);
  };

  const row = (fact: MemoryFact) => {
    const id = `${fact.domain}:${fact.key}`;
    return (
      <div key={id} className="glass-card p-3 group">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <p className="text-[13px] font-medium leading-snug break-words">{fact.label}</p>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-muted">
              {fact.domain && <span className="flex items-center gap-1"><Globe size={9} /> {fact.domain}</span>}
              <span className="flex items-center gap-1">
                {fact.source === 'typed' ? <><Keyboard size={9} /> you typed it</> : <><Sparkles size={9} /> from a fill</>}
              </span>
              {fact.hits > 1 && <span>· confirmed {fact.hits}×</span>}
            </div>
          </div>
          <button
            className="btn-ghost !p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => forget(fact)}
            title="Forget this"
          >
            <Trash2 size={13} />
          </button>
        </div>
        <input
          className="glass-input !py-1.5 text-[13px]"
          value={fact.value}
          onFocus={() => setEditing(id)}
          onBlur={() => setEditing(null)}
          onChange={(e) => edit(fact, e.target.value)}
        />
        {editing === id && <p className="text-[10px] text-primary-400 mt-1">Saved as you type.</p>}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-xl font-bold tracking-tight leading-none flex items-center gap-2">
            <Brain size={19} className="text-violet-400" /> Memory
          </h2>
          <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
            {facts.length ? `${facts.length} things learned about you` : 'Nothing learned yet'}
          </p>
        </div>
        {facts.length > 0 && (
          <button className="btn-ghost !text-[11px] !px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={wipe}>
            Forget all
          </button>
        )}
      </div>

      {facts.length > 6 && (
        <div className="relative shrink-0">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="glass-input !pl-8 !py-2 text-[13px]"
            placeholder="Search what it knows…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1 pb-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-[#18181b] shimmer" />)}
          </div>
        ) : facts.length === 0 ? (
          <div className="glass-card-static p-5 text-center space-y-2.5">
            <Brain size={30} className="mx-auto text-violet-400/50" />
            <p className="text-[13px] font-semibold">FormPilot learns as you browse</p>
            <p className="text-[11px] text-muted leading-relaxed">
              Every answer you fill or type into a form gets remembered here, so the next form is answered
              instantly and for free. Passwords, card numbers and anything that looks like a secret are never
              stored — those stay in the vault.
            </p>
          </div>
        ) : (
          <>
            {global.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-light px-0.5">About you — everywhere</h3>
                {global.map(row)}
              </section>
            )}
            {scoped.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-light px-0.5">Site-specific answers</h3>
                {scoped.map(row)}
              </section>
            )}
            {visible.length === 0 && <p className="text-xs text-muted text-center py-6">Nothing matches "{query}".</p>}
          </>
        )}
      </div>

      <div className="glass-card-static p-3 flex items-start gap-2.5 shrink-0">
        <ShieldCheck size={15} className="text-green-500 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-light leading-relaxed">
          Memory lives in this browser only. It is never uploaded unless you turn on sync, and secrets are
          filtered out before anything is written.
        </p>
      </div>
    </div>
  );
}
