import React, { useEffect, useState } from 'react';
import { UserCircle, Settings2, ArrowRight, ScanLine, Brain, Check } from 'lucide-react';
import type { Page, Settings, Profile } from '../../shared/types';
import { getMemory } from '../../shared/memory';

interface DashboardProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  navigateTo: (page: Page) => void;
  profiles: Profile[];
  fieldCount: number;
}

export default function DashboardPage({ settings, navigateTo, profiles, fieldCount }: DashboardProps) {
  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId) || profiles[0];
  const [factCount, setFactCount] = useState<number | null>(null);

  useEffect(() => { getMemory().then((f) => setFactCount(f.length)); }, []);

  // Any configured provider counts — the list is open-ended now.
  const hasApiKey = Object.values(settings.providers ?? {}).some((p) => p?.apiKey);
  const hasProfileSetup = Boolean(activeProfile?.data?.firstName || activeProfile?.data?.rawInfo);
  const ready = hasApiKey && hasProfileSetup;

  const steps = [
    {
      done: hasApiKey,
      icon: <Settings2 size={16} />,
      title: 'Connect an AI provider',
      hint: hasApiKey ? 'Key saved' : 'Any of 13 providers, or your own endpoint',
      page: 'settings' as Page,
    },
    {
      done: hasProfileSetup,
      icon: <UserCircle size={16} />,
      title: 'Tell it about you',
      hint: hasProfileSetup ? `${activeProfile?.name} is set up` : 'Paste a résumé or a note — that is enough',
      page: 'profiles' as Page,
    },
    {
      done: ready && fieldCount > 0,
      icon: <ScanLine size={16} />,
      title: 'Scan & fill',
      hint: fieldCount > 0 ? `${fieldCount} fields waiting on this page` : 'Open any form and hit Scan',
      page: 'home' as Page,
    },
  ];

  return (
    <div className="flex flex-col h-full gap-5 overflow-y-auto pr-1 animate-fade-in">
      <div className="flex flex-col items-center text-center gap-2 mt-3">
        <img src="/icons/icon128.png" className="w-14 h-14 rounded-2xl shadow-[0_0_28px_rgba(14,165,233,0.4)]" alt="" />
        <h2 className="text-xl font-bold tracking-tight">FormPilot</h2>
        <p className="text-xs text-muted-light max-w-[280px] leading-relaxed">
          Reads every field on the page, fills it from what it knows about you, and remembers your answers for next time.
        </p>
      </div>

      <section className="space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-light px-0.5">
          {ready ? 'You’re set up' : 'Get started'}
        </h3>

        {steps.map((step, i) => (
          <button
            key={step.title}
            onClick={() => navigateTo(step.page)}
            className={`w-full glass-card-static p-3 flex items-center justify-between gap-3 text-left transition-colors hover:border-primary-500/40 ${
              step.done ? 'opacity-70' : 'border-primary-500/40 bg-primary-500/[0.06]'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                step.done ? 'bg-green-500/10 text-green-400' : 'bg-primary-500/10 text-primary-400'
              }`}>
                {step.done ? <Check size={16} /> : step.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight">{i + 1}. {step.title}</p>
                <p className="text-[11px] text-muted mt-0.5 truncate">{step.hint}</p>
              </div>
            </div>
            <ArrowRight size={14} className="text-muted-dark shrink-0" />
          </button>
        ))}
      </section>

      <button
        onClick={() => navigateTo('memory')}
        className="glass-card p-3 flex items-center gap-3 text-left hover:border-violet-500/40 transition-colors"
      >
        <div className="w-9 h-9 rounded-xl bg-violet-500/10 text-violet-400 flex items-center justify-center shrink-0">
          <Brain size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">What it knows about you</p>
          <p className="text-[11px] text-muted mt-0.5">
            {factCount === null ? 'Loading…' : factCount === 0 ? 'Learning starts with your first fill' : `${factCount} facts learned so far`}
          </p>
        </div>
        <ArrowRight size={14} className="text-muted-dark shrink-0" />
      </button>
    </div>
  );
}
