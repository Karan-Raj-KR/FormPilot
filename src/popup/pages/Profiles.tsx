import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Plus, Edit2, Trash2, CheckCircle2, ChevronDown, ChevronUp, Copy, Check,
  Copy as Duplicate, AlertTriangle, ShieldAlert, Sparkles, X,
  FileUp, Loader2, FileText,
} from 'lucide-react';
import type { Profile, Settings, ProfileData } from '../../shared/types';
import { addProfile, updateProfile, deleteProfile, saveSettings, generateId } from '../../shared/storage';
import {
  EMPTY_PROFILE_DATA, PROFILE_COLORS, PROFILE_EMOJIS, TONE_OPTIONS, LENGTH_OPTIONS,
  SYSTEM_PROMPT_PRESETS,
} from '../../shared/constants';
import {
  validateProfile, findSecrets, profileCompleteness, missingFields,
  normalizeProfile, LIMITS,
} from '../../shared/profile';
import { mergeExtraction, type ExtractedProfile } from '../../shared/resume';
import { fileToText, ACCEPTED_TYPES } from '../../shared/resume-file';
import { getJob, setJob, onJobChange, type ImportJob } from '../../shared/jobs';
import { useSessionState, SESSION_KEYS } from '../session';

interface ProfilesProps {
  profiles: Profile[];
  setProfiles: React.Dispatch<React.SetStateAction<Profile[]>>;
  activeProfileId: string;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

type Section = 'raw' | 'basic' | 'address' | 'work' | 'links' | 'custom' | 'instructions' | '';

const LLM_CONTEXT_PROMPT = `Please compile everything you know about me into a structured personal profile. Include all of the following that you know:

- Full name
- Email address
- Phone number
- Home address (street, city, state, zip, country)
- Current job title and company
- Years of experience
- Key skills (comma-separated)
- A 2–3 sentence professional bio
- Work experience highlights (role, company, brief description)
- Education (degree, institution, year)
- Notable projects (name + one-line description)
- LinkedIn URL
- GitHub URL
- Personal website
- Any other relevant personal or professional information

Do not include passwords, card numbers, national ID numbers or any other secret.

Format it as clean plain text — no markdown, no headers — so I can paste it directly into a form-filling assistant.`;

export default function Profiles({ profiles, setProfiles, activeProfileId, setSettings }: ProfilesProps) {
  /* The editor lives in session storage, not component state. Chrome destroys
     the popup whenever it loses focus — clicking the page behind it, opening a
     file chooser — and a half-typed profile should still be there afterwards. */
  const [draft, setDraft, draftRestored] = useSessionState<{
    editingId: string | null;
    isCreating: boolean;
    openSection: Section;
    formData: Partial<Profile>;
  }>(SESSION_KEYS.PROFILE_DRAFT, { editingId: null, isCreating: false, openSection: 'raw', formData: {} });

  const { editingId, isCreating, openSection, formData } = draft;
  const setEditingId = (editingId: string | null) => setDraft((d) => ({ ...d, editingId }));
  const setIsCreating = (isCreating: boolean) => setDraft((d) => ({ ...d, isCreating }));
  const setOpenSection = (openSection: Section) => setDraft((d) => ({ ...d, openSection }));
  const setFormData = (next: Partial<Profile> | ((prev: Partial<Profile>) => Partial<Profile>)) =>
    setDraft((d) => ({ ...d, formData: typeof next === 'function' ? next(d.formData) : next }));
  const closeEditor = () => setDraft({ editingId: null, isCreating: false, openSection: 'raw', formData: {} });
  const [showErrors, setShowErrors] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  const issues = useMemo(() => validateProfile(formData), [formData]);
  const secrets = useMemo(() => findSecrets(formData), [formData]);
  const errors = issues.filter((i) => i.severity === 'error');
  const issueFor = (field: string) => issues.find((i) => i.field === field);

  const [job, setJobState] = useState<ImportJob | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<Partial<Profile> | null>(null);
  const [autoFilled, setAutoFilled] = useState<string[] | null>(null);
  const lastSummarySent = useRef('');
  const scrollView = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /* The job runs in the background and reports through storage, so a result
     that arrived while the popup was shut is still waiting when it reopens. */
  useEffect(() => {
    getJob().then(setJobState);
    return onJobChange(setJobState);
  }, []);

  // A draft that came back from session storage carries text that was already
  // handled before the popup closed.
  useEffect(() => {
    if (draftRestored && !lastSummarySent.current) {
      lastSummarySent.current = (draft.formData.data?.rawInfo ?? '').trim();
    }
  }, [draftRestored]);

  // A summary import fills the profile the moment it lands — that is the point
  // of pasting a summary. A résumé is shown for review first.
  useEffect(() => {
    if (job?.status !== 'done' || !job.result) return;
    if (job.source !== 'summary') return;
    applyExtraction(job.result, job.text ?? '', false);
    setAutoFilled(job.result.filled);
    void setJob(null);
  }, [job?.id, job?.status]);

  const startImport = async (text: string, source: 'resume' | 'summary', label: string) => {
    setImportError(null);
    const pending: ImportJob = {
      id: String(Date.now()), status: 'running', source, label, startedAt: Date.now(), text,
    };
    setJobState(pending);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXTRACT_PROFILE', text, source, label, jobId: pending.id,
      });
      if (!response?.started) throw new Error('The extension background did not start the import. Reload the extension and retry.');
    } catch (err: any) {
      setJobState(null);
      setImportError(err?.message ?? 'Could not start the import.');
    }
  };

  const importResume = async (file: File) => {
    setImportError(null);
    setReading(true);
    try {
      const text = await fileToText(file);
      await startImport(text, 'resume', file.name);
    } catch (err: any) {
      setImportError(err?.message ?? 'Could not read that file.');
    } finally {
      setReading(false);
    }
  };

  /* Pasting an LLM summary into "About you" should populate the rest of the
     form by itself — the user has already given us everything, they should not
     have to retype it into twenty boxes. */
  const maybeImportSummary = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length < 200) return;                 // too short to be a profile
    // Seeded with whatever was in the box when the editor opened, so merely
    // clicking through an existing profile never spends an API call.
    if (trimmed === lastSummarySent.current) return;
    if (job?.status === 'running') return;
    lastSummarySent.current = trimmed;
    void startImport(trimmed, 'summary', 'your summary');
  };

  const applyExtraction = (extracted: ExtractedProfile, text: string, overwrite: boolean) => {
    setUndoSnapshot(structuredClone(draft.formData));
    setFormData((prev) => mergeExtraction(prev, extracted, text, overwrite) as Partial<Profile>);
  };

  const applyImport = (overwrite: boolean) => {
    if (job?.status !== 'done' || !job.result) return;
    applyExtraction(job.result, job.text ?? '', overwrite);
    setAutoFilled(job.result.filled);
    void setJob(null);
    setJobState(null);
    setOpenSection('basic');
    scrollView.current?.scrollTo(0, 0);
  };

  const undoImport = () => {
    if (!undoSnapshot) return;
    setFormData(undoSnapshot);
    setUndoSnapshot(null);
    setAutoFilled(null);
  };

  const dismissJob = () => { void setJob(null); setJobState(null); };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(LLM_CONTEXT_PROMPT);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2500);
  };

  const startEdit = (profile: Profile) => {
    lastSummarySent.current = (profile.data?.rawInfo ?? '').trim();
    setDraft({ editingId: profile.id, isCreating: false, openSection: 'raw', formData: structuredClone(profile) });
    setShowErrors(false);
    setImportError(null);
    setTimeout(() => scrollView.current?.scrollTo(0, 0), 10);
  };

  const startCreate = (from?: Profile) => {
    const blank = from
      ? { ...structuredClone(from), name: `${from.name} copy` }
      : ({
          name: '',
          color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
          emoji: PROFILE_EMOJIS[profiles.length % PROFILE_EMOJIS.length],
          data: { ...EMPTY_PROFILE_DATA, customFields: {} },
          systemPrompt: '',
          tonePreference: 'professional',
          lengthPreference: 'moderate',
        } as Partial<Profile>);
    lastSummarySent.current = (blank.data?.rawInfo ?? '').trim();
    setDraft({ editingId: null, isCreating: true, openSection: 'raw', formData: blank });
    setShowErrors(false);
    setImportError(null);
    setTimeout(() => scrollView.current?.scrollTo(0, 0), 10);
  };

  const saveForm = async () => {
    setShowErrors(true);
    if (errors.length > 0) {
      setOpenSection(sectionOf(errors[0].field));
      scrollView.current?.scrollTo(0, 0);
      return;
    }

    const clean = normalizeProfile(formData);
    if (isCreating) {
      const created: Profile = {
        ...(clean as Profile),
        id: generateId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setProfiles(await addProfile(created));
      // A brand-new profile is what the user wants to use next.
      await setActiveProfile(created.id);
    } else if (editingId) {
      setProfiles(await updateProfile({ ...clean, id: editingId, updatedAt: Date.now() } as Profile));
    }
    closeEditor();
  };

  const removeProfile = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const profile = profiles.find((p) => p.id === id);
    if (!confirm(`Delete "${profile?.name}"? Everything saved in it is lost.`)) return;
    const updated = await deleteProfile(id);
    setProfiles(updated);
    if (activeProfileId === id && updated.length > 0) await setActiveProfile(updated[0].id);
  };

  const setActiveProfile = async (id: string) => {
    setSettings((prev) => {
      const next = { ...prev, activeProfileId: id };
      saveSettings(next);
      return next;
    });
  };

  const setField = (field: keyof ProfileData, value: string) => {
    setFormData((prev) => ({ ...prev, data: { ...(prev.data as ProfileData), [field]: value } }));
  };

  const setCustomField = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      data: { ...(prev.data as ProfileData), customFields: { ...(prev.data?.customFields ?? {}), [key]: value } },
    }));
  };

  const renameCustomField = (oldKey: string, newKey: string) => {
    setFormData((prev) => {
      const entries = Object.entries(prev.data?.customFields ?? {});
      const renamed = entries.map(([k, v]) => (k === oldKey ? [newKey, v] : [k, v]));
      return { ...prev, data: { ...(prev.data as ProfileData), customFields: Object.fromEntries(renamed) } };
    });
  };

  const removeCustomField = (key: string) => {
    setFormData((prev) => {
      const rest = { ...(prev.data?.customFields ?? {}) };
      delete rest[key];
      return { ...prev, data: { ...(prev.data as ProfileData), customFields: rest } };
    });
  };

  /* ─── List view ─── */
  if (!editingId && !isCreating) {
    return (
      <div className="flex flex-col h-full gap-3 pt-1">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold tracking-tight">Profiles</h2>
          <span className="text-[11px] text-muted">{profiles.length} saved</span>
        </div>

        <div className="space-y-2.5 flex-1 overflow-y-auto pb-2 pr-1">
          {profiles.map((profile, i) => {
            const isActive = profile.id === activeProfileId;
            const percent = profileCompleteness(profile);
            const gaps = missingFields(profile);
            return (
              <div
                key={profile.id}
                onClick={() => setActiveProfile(profile.id)}
                className={`glass-card p-3 cursor-pointer stagger-${Math.min(i + 1, 5)} animate-slide-up group ${
                  isActive ? 'border-primary-500/50 bg-primary-500/5' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: `${profile.color}20`, color: profile.color }}
                  >
                    {profile.emoji}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className={`font-semibold truncate ${isActive ? 'text-primary-400' : ''}`}>{profile.name}</h3>
                      {isActive && <CheckCircle2 size={13} className="text-primary-500 shrink-0" />}
                      {profile.systemPrompt?.trim() && (
                        <span title="Has custom instructions"><Sparkles size={11} className="text-secondary-400 shrink-0" /></span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted truncate mt-0.5">
                      {profile.data?.role || profile.data?.bio || 'No details yet'}
                    </p>
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="btn-ghost !p-1.5" title="Edit" onClick={(e) => { e.stopPropagation(); startEdit(profile); }}>
                      <Edit2 size={13} />
                    </button>
                    <button className="btn-ghost !p-1.5" title="Duplicate" onClick={(e) => { e.stopPropagation(); startCreate(profile); }}>
                      <Duplicate size={13} />
                    </button>
                    {profiles.length > 1 && (
                      <button className="btn-ghost !p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10" title="Delete" onClick={(e) => removeProfile(profile.id, e)}>
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Completeness — a half-filled profile is the usual reason a fill disappoints */}
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${percent}%`, backgroundColor: percent > 66 ? '#22c55e' : percent > 33 ? '#f59e0b' : '#ef4444' }}
                    />
                  </div>
                  <span className="text-[10px] text-muted tabular-nums w-8 text-right">{percent}%</span>
                </div>
                {gaps.length > 0 && (
                  <p className="text-[10px] text-muted-dark mt-1 truncate">
                    Missing: {gaps.slice(0, 4).map(humanize).join(', ')}{gaps.length > 4 ? '…' : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2 shrink-0">
          <button className="btn-secondary py-3" onClick={() => startCreate()}>
            <Plus size={15} />
            <span className="text-xs">New profile</span>
          </button>
          {/* The fastest path from install to a working profile. */}
          <button className="btn-primary py-3" onClick={() => { startCreate(); setTimeout(() => fileInput.current?.click(), 60); }}>
            <FileUp size={15} />
            <span className="text-xs">From résumé</span>
          </button>
        </div>
      </div>
    );
  }

  /* ─── Edit view ─── */
  const data = (formData.data ?? EMPTY_PROFILE_DATA) as ProfileData;
  const customEntries = Object.entries(data.customFields ?? {});

  return (
    <div className="flex flex-col h-full -mx-4 -my-4 h-[calc(100%+2rem)] bg-[#09090b]" ref={scrollView}>
      <div className="flex items-center justify-between p-4 border-b border-[#27272a] sticky top-0 bg-[#09090b]/95 backdrop-blur-md z-20">
        <button className="btn-ghost !text-xs" onClick={closeEditor}>Cancel</button>
        <span className="font-semibold text-sm">{isCreating ? 'New profile' : 'Edit profile'}</span>
        <button className="btn-primary !px-3 !py-1.5 !text-xs" onClick={saveForm}>Save</button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto pb-10">
        {/* Résumé import */}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';           // same file twice must still fire
            if (file) importResume(file);
          }}
        />

        {job?.status === 'done' && job.result ? (
          <div className="glass-card-static p-3 space-y-3 border-primary-500/40 bg-primary-500/5">
            <div className="flex items-start gap-2">
              <FileText size={14} className="text-primary-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-xs font-semibold">Found {job.result.filled.length} things in {job.label}</p>
                <p className="text-[10px] text-muted mt-0.5">Review before it goes in — nothing is saved yet.</p>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {Object.entries(job.result.data).map(([key, value]) => (
                key === 'customFields' ? (
                  Object.entries(value as Record<string, string>).map(([k, v]) => (
                    <Row key={k} label={k} value={v} tag="custom" />
                  ))
                ) : (
                  <Row key={key} label={humanize(key)} value={String(value)} />
                )
              ))}
              {job.result.systemPrompt && <Row label="Custom instructions" value={job.result.systemPrompt} tag="style" />}
            </div>

            <div className="flex gap-2">
              <button className="btn-primary !py-1.5 !text-xs flex-1" onClick={() => applyImport(false)}>
                Fill empty fields
              </button>
              <button className="btn-secondary !py-1.5 !text-xs" onClick={() => applyImport(true)}>
                Replace all
              </button>
              <button className="btn-ghost !p-1.5" onClick={dismissJob} title="Discard">
                <X size={14} />
              </button>
            </div>
          </div>
        ) : job?.status === 'running' || reading ? (
          <div className="glass-card-static p-3 flex items-center gap-2.5">
            <Loader2 size={15} className="animate-spin text-primary-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold">
                {reading ? 'Reading the file…' : `Pulling details out of ${job?.label ?? 'your text'}…`}
              </p>
              <p className="text-[10px] text-muted mt-0.5">
                Keeps running if you close this — come back and it will be here.
              </p>
            </div>
          </div>
        ) : (
          <div className="glass-card-static p-3 space-y-2">
            <button className="btn-secondary w-full !py-2.5 !text-xs" onClick={() => fileInput.current?.click()}>
              <FileUp size={14} /> Import from résumé
            </button>
            <p className="text-[10px] text-muted-dark leading-relaxed text-center">
              PDF, DOCX, RTF, TXT or MD. Read on this device; the text is then sent to
              your AI provider to be sorted into fields.
            </p>
          </div>
        )}

        {/* Result of an automatic fill from a pasted summary */}
        {autoFilled && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-2">
            <Check size={14} className="text-green-400 shrink-0" />
            <p className="text-[11px] text-green-300 flex-1">
              Filled {autoFilled.length} field{autoFilled.length === 1 ? '' : 's'} from your summary.
            </p>
            {undoSnapshot && (
              <button className="btn-ghost !py-1 !px-2 !text-[10px]" onClick={undoImport}>Undo</button>
            )}
            <button className="btn-ghost !p-1" onClick={() => setAutoFilled(null)}><X size={12} /></button>
          </div>
        )}

        {(importError || job?.status === 'error') && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-red-300 leading-relaxed flex-1">{importError ?? job?.error}</p>
            <button className="btn-ghost !p-1" onClick={() => { setImportError(null); dismissJob(); }}>
              <X size={12} />
            </button>
          </div>
        )}

        {showErrors && errors.length > 0 && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-red-300 space-y-0.5">
              {errors.map((e) => <p key={e.field}>{e.message}</p>)}
            </div>
          </div>
        )}

        {/* Anything that leaves the device should be flagged before it does */}
        {secrets.length > 0 && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
            <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-200/90 leading-relaxed">
              <strong className="text-amber-300">Possible secret in {secrets.map(humanize).join(', ')}.</strong>{' '}
              Everything in a profile is sent to your AI provider on every fill. Card numbers,
              passwords and ID numbers belong in the Vault, which is never sent.
            </div>
          </div>
        )}

        {/* Identity */}
        <div className="glass-card-static p-3 space-y-3">
          <div className="flex items-end gap-3">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shrink-0 border border-[#27272a]"
              style={{ backgroundColor: `${formData.color}20` }}
            >
              {formData.emoji}
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">Profile name</label>
              <input
                className={`glass-input !py-1.5 ${showErrors && issueFor('name') ? '!border-red-500/60' : ''}`}
                placeholder="Work, Personal, Grad school…"
                value={formData.name ?? ''}
                maxLength={LIMITS.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PROFILE_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => setFormData({ ...formData, emoji })}
                className={`w-7 h-7 rounded-lg text-base flex items-center justify-center transition-all ${
                  formData.emoji === emoji ? 'bg-white/10 scale-110' : 'hover:bg-white/5 opacity-60'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setFormData({ ...formData, color })}
                className={`w-6 h-6 rounded-full transition-all ${formData.color === color ? 'ring-2 ring-white/70 scale-110' : 'opacity-70 hover:opacity-100'}`}
                style={{ backgroundColor: color }}
                aria-label={color}
              />
            ))}
          </div>
        </div>

        {/* Writing style */}
        <div className="grid grid-cols-2 gap-2">
          <select className="glass-input cursor-pointer !py-2" value={formData.tonePreference} onChange={(e) => setFormData({ ...formData, tonePreference: e.target.value as any })}>
            {TONE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.icon} {o.label}</option>)}
          </select>
          <select className="glass-input cursor-pointer !py-2" value={formData.lengthPreference} onChange={(e) => setFormData({ ...formData, lengthPreference: e.target.value as any })}>
            {LENGTH_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.icon} {o.label}</option>)}
          </select>
        </div>

        {/* Raw info */}
        <Accordion title="About you" hint="Paste a résumé or an LLM summary — the AI reads this first" open={openSection === 'raw'} onToggle={() => setOpenSection(openSection === 'raw' ? '' : 'raw')}>
          <div className="rounded-lg border border-primary-500/20 bg-primary-500/5 p-2.5 space-y-2">
            <p className="text-[10px] text-muted-light leading-relaxed">
              No summary handy? Copy this prompt into ChatGPT, Claude or Gemini and paste the answer below.
            </p>
            <button
              onClick={copyPrompt}
              className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-md transition-all ${
                promptCopied ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-primary-500/15 text-primary-400 border border-primary-500/25 hover:bg-primary-500/25'
              }`}
            >
              {promptCopied ? <Check size={11} /> : <Copy size={11} />}
              {promptCopied ? 'Copied' : 'Copy prompt for any LLM'}
            </button>
          </div>
          <Counter value={data.rawInfo} max={LIMITS.rawInfo} />
          <textarea
            className={`glass-textarea !min-h-[130px] font-mono text-[11px] ${showErrors && issueFor('rawInfo') ? '!border-red-500/60' : ''}`}
            value={data.rawInfo}
            onChange={(e) => setField('rawInfo', e.target.value)}
            // Pasting is the common case, and waiting for blur after a paste
            // feels broken — so both trigger the fill.
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              if (pasted) setTimeout(() => maybeImportSummary(pasted), 0);
            }}
            onBlur={(e) => maybeImportSummary(e.target.value)}
            placeholder="Everything about you: résumé, bio, achievements, preferences. Paste an LLM summary here and the rest of this form fills itself."
          />
          <p className="text-[10px] text-muted-dark leading-relaxed">
            Paste a summary and the fields below fill in automatically.
          </p>
        </Accordion>

        {/* Basics */}
        <Accordion title="Basics" open={openSection === 'basic'} onToggle={() => setOpenSection(openSection === 'basic' ? '' : 'basic')}>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="First name" value={data.firstName} onChange={(v) => setField('firstName', v)} />
            <Field label="Last name" value={data.lastName} onChange={(v) => setField('lastName', v)} />
            <Field className="col-span-2" label="Email" type="email" value={data.email} onChange={(v) => setField('email', v)} issue={showErrors ? issueFor('email') : undefined} />
            <Field className="col-span-2" label="Phone" type="tel" value={data.phone} onChange={(v) => setField('phone', v)} issue={showErrors ? issueFor('phone') : undefined} />
            <div className="col-span-2 space-y-1">
              <label className="text-xs text-muted-light">Short bio</label>
              <textarea className="glass-textarea" rows={3} value={data.bio} onChange={(e) => setField('bio', e.target.value)} placeholder="Two sentences on who you are." />
            </div>
          </div>
        </Accordion>

        {/* Address */}
        <Accordion title="Address" open={openSection === 'address'} onToggle={() => setOpenSection(openSection === 'address' ? '' : 'address')}>
          <div className="grid grid-cols-2 gap-2.5">
            <Field className="col-span-2" label="Street address" value={data.address} onChange={(v) => setField('address', v)} />
            <Field label="City" value={data.city} onChange={(v) => setField('city', v)} />
            <Field label="State / region" value={data.state} onChange={(v) => setField('state', v)} />
            <Field label="Postal code" value={data.zipCode} onChange={(v) => setField('zipCode', v)} />
            <Field label="Country" value={data.country} onChange={(v) => setField('country', v)} />
          </div>
        </Accordion>

        {/* Work & education */}
        <Accordion title="Work & education" open={openSection === 'work'} onToggle={() => setOpenSection(openSection === 'work' ? '' : 'work')}>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Company" value={data.company} onChange={(v) => setField('company', v)} />
            <Field label="Role / title" value={data.role} onChange={(v) => setField('role', v)} />
          </div>
          <TextArea label="Skills" value={data.skills} onChange={(v) => setField('skills', v)} placeholder="TypeScript, React, distributed systems…" rows={2} />
          <TextArea label="Education" value={data.education} onChange={(v) => setField('education', v)} placeholder="B.Tech Computer Science, VIT, 2024" rows={2} />
          <TextArea label="Experience" value={data.experience} onChange={(v) => setField('experience', v)} placeholder="Roles, companies, what you did." rows={3} />
          <TextArea label="Projects" value={data.projects} onChange={(v) => setField('projects', v)} placeholder="Name — one line on what it does." rows={3} />
        </Accordion>

        {/* Links */}
        <Accordion title="Links" open={openSection === 'links'} onToggle={() => setOpenSection(openSection === 'links' ? '' : 'links')}>
          <Field label="Website" value={data.website} onChange={(v) => setField('website', v)} issue={showErrors ? issueFor('website') : undefined} placeholder="you.dev" />
          <Field label="LinkedIn" value={data.linkedin} onChange={(v) => setField('linkedin', v)} issue={showErrors ? issueFor('linkedin') : undefined} placeholder="linkedin.com/in/you" />
          <Field label="GitHub" value={data.github} onChange={(v) => setField('github', v)} issue={showErrors ? issueFor('github') : undefined} placeholder="github.com/you" />
          <Field label="X / Twitter" value={data.twitter} onChange={(v) => setField('twitter', v)} issue={showErrors ? issueFor('twitter') : undefined} placeholder="x.com/you" />
        </Accordion>

        {/* Custom fields */}
        <Accordion
          title="Custom fields"
          hint="Anything the built-in fields don't cover"
          badge={customEntries.length ? String(customEntries.length) : undefined}
          open={openSection === 'custom'}
          onToggle={() => setOpenSection(openSection === 'custom' ? '' : 'custom')}
        >
          {customEntries.length === 0 && (
            <p className="text-[11px] text-muted leading-relaxed">
              Add facts forms keep asking you for: visa status, dietary needs, t-shirt size,
              notice period, emergency contact.
            </p>
          )}
          {customEntries.map(([key, value]) => (
            <div key={key} className="flex gap-2 items-start">
              <input
                className="glass-input !py-1.5 !text-[11px] w-[38%]"
                value={key}
                maxLength={LIMITS.customKey}
                onChange={(e) => renameCustomField(key, e.target.value)}
                placeholder="Question"
              />
              <input
                className="glass-input !py-1.5 !text-[11px] flex-1"
                value={value}
                onChange={(e) => setCustomField(key, e.target.value)}
                placeholder="Answer"
              />
              <button className="btn-ghost !p-1.5 text-red-400 hover:bg-red-500/10 shrink-0" onClick={() => removeCustomField(key)}>
                <X size={13} />
              </button>
            </div>
          ))}
          {customEntries.length < LIMITS.customFields && (
            <button
              className="btn-ghost !text-[11px] !py-1.5"
              onClick={() => setCustomField(`Field ${customEntries.length + 1}`, '')}
            >
              <Plus size={12} /> Add field
            </button>
          )}
        </Accordion>

        {/* System prompt */}
        <Accordion
          title="Custom instructions"
          hint="Standing rules for how the AI answers with this profile"
          badge={formData.systemPrompt?.trim() ? 'on' : undefined}
          open={openSection === 'instructions'}
          onToggle={() => setOpenSection(openSection === 'instructions' ? '' : 'instructions')}
        >
          <div className="flex flex-wrap gap-1.5">
            {SYSTEM_PROMPT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="text-[10px] px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-muted-light border border-white/10"
                onClick={() => setFormData({ ...formData, systemPrompt: preset.text })}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Counter value={formData.systemPrompt ?? ''} max={LIMITS.systemPrompt} />
          <textarea
            className={`glass-textarea !min-h-[110px] text-[12px] ${showErrors && issueFor('systemPrompt') ? '!border-red-500/60' : ''}`}
            value={formData.systemPrompt ?? ''}
            onChange={(e) => setFormData({ ...formData, systemPrompt: e.target.value })}
            placeholder={'Write in first person and keep answers under 100 words.\nNever mention that I am currently job-hunting.\nFor "how did you hear about us", always answer "LinkedIn".'}
          />
          <p className="text-[10px] text-muted-dark leading-relaxed">
            Sent with every fill that uses this profile. It guides tone and wording — it can't
            override the rules that keep passwords, card numbers and one-time codes out of the AI.
          </p>
        </Accordion>
      </div>
    </div>
  );
}

/* ─── Small pieces ─── */

function sectionOf(field: string): Section {
  if (['email', 'phone'].includes(field)) return 'basic';
  if (['website', 'linkedin', 'github', 'twitter'].includes(field)) return 'links';
  if (field === 'rawInfo') return 'raw';
  if (field === 'systemPrompt') return 'instructions';
  if (field === 'customFields') return 'custom';
  return '';
}

function humanize(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim().toLowerCase();
}

function Row({ label, value, tag }: { label: string; value: string; tag?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px] py-0.5">
      <span className="text-muted shrink-0 max-w-[38%] truncate">{label}</span>
      {tag && <span className="badge badge-accent !text-[8px] !px-1 shrink-0">{tag}</span>}
      <span className="text-white/90 truncate flex-1 text-right" title={value}>{value}</span>
    </div>
  );
}

function Accordion({ title, hint, badge, open, onToggle, children }: {
  title: string; hint?: string; badge?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="glass-card-static rounded-lg overflow-hidden">
      <button className="w-full flex items-center justify-between p-3 bg-[#18181b]/50 text-left" onClick={onToggle}>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-semibold text-sm flex items-center gap-1.5">
            {title}
            {badge && <span className="badge badge-accent !text-[9px] !px-1.5">{badge}</span>}
          </span>
          {hint && <span className="text-[10px] text-muted truncate">{hint}</span>}
        </div>
        {open ? <ChevronUp size={15} className="shrink-0" /> : <ChevronDown size={15} className="shrink-0" />}
      </button>
      {open && <div className="p-3 space-y-3 border-t border-[#27272a]">{children}</div>}
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, issue, className = '' }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; issue?: { message: string; severity: string }; className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="text-xs text-muted-light">{label}</label>
      <input
        className={`glass-input !py-1.5 ${issue ? (issue.severity === 'error' ? '!border-red-500/60' : '!border-amber-500/50') : ''}`}
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        maxLength={LIMITS.field}
        onChange={(e) => onChange(e.target.value)}
      />
      {issue && (
        <p className={`text-[10px] ${issue.severity === 'error' ? 'text-red-400' : 'text-amber-400'}`}>{issue.message}</p>
      )}
    </div>
  );
}

function TextArea({ label, value, onChange, placeholder, rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-light">{label}</label>
      <textarea className="glass-textarea" rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  const used = value?.length ?? 0;
  if (used < max * 0.6) return null;
  return (
    <p className={`text-[10px] text-right tabular-nums ${used > max ? 'text-red-400' : 'text-muted'}`}>
      {used.toLocaleString()} / {max.toLocaleString()}
    </p>
  );
}
