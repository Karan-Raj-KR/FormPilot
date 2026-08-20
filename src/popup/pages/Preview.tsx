import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Wand2, RefreshCw, XCircle, Lock, AlertTriangle, Save, X,
  Brain, Sparkles, Check, Asterisk,
} from 'lucide-react';
import type { DetectedField, Profile, Page, PageContext, MemoryFact } from '../../shared/types';
import {
  getSettings, addHistoryEntry, generateId,
  getPaymentCards, getPasswordsForDomain, addPassword,
} from '../../shared/storage';
import { getMemory, recall, memoryForPrompt, rememberAll } from '../../shared/memory';
import { CATEGORY_CONFIG, PAYMENT_FIELD_PATTERNS, isSensitiveField, SENSITIVE_VALUE } from '../../shared/constants';
import { fillField as fillOne, highlight } from '../scan';

interface PreviewProps {
  fields: DetectedField[];
  setFields: React.Dispatch<React.SetStateAction<DetectedField[]>>;
  navigateTo: (page: Page) => void;
  activeProfile: Profile;
  activeTabUrl: string;
  pageContext: PageContext | null;
}

function getCardValueForField(field: DetectedField, card: any): string {
  const combined = `${field.label} ${field.name} ${field.ariaLabel} ${field.placeholder}`.toLowerCase();
  if (PAYMENT_FIELD_PATTERNS.cvv.test(combined))            return card.cvv;
  if (PAYMENT_FIELD_PATTERNS.cardholderName.test(combined)) return card.cardholderName;
  if (PAYMENT_FIELD_PATTERNS.expiryMonth.test(combined))    return card.expiryMonth;
  if (PAYMENT_FIELD_PATTERNS.expiryYear.test(combined))     return card.expiryYear;
  if (PAYMENT_FIELD_PATTERNS.expiryFull.test(combined))     return `${card.expiryMonth}/${String(card.expiryYear).slice(-2)}`;
  if (PAYMENT_FIELD_PATTERNS.cardNumber.test(combined))     return card.cardNumber;
  return '';
}

const isVaultField = (f: DetectedField) => f.category === 'payment' || f.category === 'credential';

// "Question: Dietary needs | Option: Vegetarian" reads badly in a list. Split it
// so the question becomes the group heading and the option becomes the label.
function splitLabel(field: DetectedField): { question: string; label: string } {
  const match = /^Question:\s*(.*?)(?:\s*\|\s*Option:\s*(.*))?$/.exec(field.label);
  if (match) return { question: match[1]?.trim() ?? '', label: match[2]?.trim() || match[1]?.trim() || '' };
  return { question: field.section ?? '', label: field.label || field.name || 'Unnamed field' };
}

export default function Preview({ fields, setFields, navigateTo, activeProfile, activeTabUrl, pageContext }: PreviewProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isFilling, setIsFilling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [savePrompt, setSavePrompt] = useState<{ username: string; password: string; domain: string } | null>(null);
  const [savingCred, setSavingCred] = useState(false);
  const [showConfidence, setShowConfidence] = useState(true);
  const [learnedCount, setLearnedCount] = useState(0);
  const [tabId, setTabId] = useState<number | null>(null);

  const domain = pageContext?.domain || (() => { try { return new URL(activeTabUrl).hostname; } catch { return ''; } })();

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => setTabId(tabs[0]?.id ?? null));
    const needsGeneration = fields.some(f => f.status === 'pending' && !f.suggestedValue);
    if (needsGeneration && !isGenerating) generateFills();
  }, []);

  const generateFills = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setSavePrompt(null);
    setLearnedCount(0);

    try {
      const settings = await getSettings();
      setShowConfidence(settings.showConfidence);

      const memory: MemoryFact[] = settings.useMemory ? await getMemory() : [];

      const [aiResponse, cards, domainPasswords] = await Promise.all([
        Promise.race([
          chrome.runtime.sendMessage({
            type: 'GENERATE_FILLS',
            payload: {
              fields,
              profile: activeProfile,
              settings,
              context: pageContext,
              memory: memoryForPrompt(memory, fields, domain),
            },
          }),
          new Promise<any>((_, reject) =>
            setTimeout(() => reject(new Error('AI generation timed out after 2 minutes. The form might be too large or the server is overloaded.')), 120000)
          ),
        ]),
        getPaymentCards(),
        getPasswordsForDomain(domain),
      ]);

      if (!aiResponse) throw new Error('Failed to connect to the extension background service.');
      if (aiResponse.error) throw new Error(aiResponse.error);

      const defaultCard = cards.find((c: any) => c.isDefault) ?? cards[0] ?? null;
      const domainCred = domainPasswords[0] ?? null;
      let learned = 0;

      setFields(prev => prev.map((f, i) => {
        // Payment fields — fill from default vault card
        if (f.category === 'payment') {
          if (defaultCard) {
            const value = getCardValueForField(f, defaultCard);
            return { ...f, suggestedValue: value, confidence: 1.0, source: 'vault', status: value ? 'ready' : 'pending' };
          }
          return { ...f, suggestedValue: '', status: 'pending' };
        }

        // Credential fields — fill from vault entry for this domain
        if (f.category === 'credential') {
          if (domainCred) {
            const value = f.type === 'password' ? domainCred.password : domainCred.username;
            return { ...f, suggestedValue: value, confidence: 1.0, source: 'vault', status: 'ready' };
          }
          return { ...f, suggestedValue: '', status: 'pending' };
        }

        // An answer the user has given before beats a fresh guess.
        const known = recall(memory, f, domain);
        if (known) {
          learned++;
          return { ...f, suggestedValue: known.value, confidence: 1.0, source: 'memory', status: 'ready' };
        }

        // Non-sensitive fields — use AI suggestion (background remapped indices back to original)
        const suggestion = (aiResponse.suggestions ?? []).find((s: any) => s.index === i);
        if (suggestion) {
          return { ...f, suggestedValue: suggestion.value, confidence: suggestion.confidence, source: 'ai', status: 'ready' };
        }
        return { ...f, status: 'error' };
      }));
      setLearnedCount(learned);

    } catch (err: any) {
      setGenerationError(err.message || 'Failed to generate responses. Please check your API key in Settings.');
      setFields(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'error' } : f));
    } finally {
      setIsGenerating(false);
    }
  };

  const fillAll = async () => {
    if (!tabId) return;
    setIsFilling(true);
    const fieldsToFill = fields.filter(f => f.status === 'ready' && f.suggestedValue);
    setProgress({ done: 0, total: fieldsToFill.length });

    try {
      let filledCount = 0;
      for (const field of fieldsToFill) {
        await fillOne(tabId, field);
        filledCount++;
        setProgress({ done: filledCount, total: fieldsToFill.length });
        setFields(prev => prev.map(f => f.id === field.id ? { ...f, status: 'filled' } : f));
        await new Promise(r => setTimeout(r, 120));
      }

      // Everything the user let through (including their own edits) becomes
      // memory. Next time on this site the answer is instant and free.
      await rememberAll(fieldsToFill, domain, 'fill').catch(() => {});

      if (filledCount > 0) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await addHistoryEntry({
            id: generateId(),
            domain,
            url: activeTabUrl,
            title: tab?.title || pageContext?.title || domain,
            profileId: activeProfile.id,
            profileName: activeProfile.name,
            fieldCount: fields.length,
            filledCount,
            // Card numbers and passwords stay in the vault — history is a plain
            // storage record that the History page renders in clear text.
            fields: fieldsToFill.map(f => ({
              label: splitLabel(f).label,
              value: isSensitiveField(f) || SENSITIVE_VALUE.test(f.suggestedValue) ? '••••••••' : f.suggestedValue,
              category: f.category,
            })),
            timestamp: Date.now(),
          });
        } catch { /* ignore history errors */ }
      }

      // Prompt to save credentials if a new password was filled and isn't in vault yet
      const filledPasswordField = fieldsToFill.find(f => f.category === 'credential' && f.type === 'password' && f.suggestedValue);
      setIsFilling(false);
      if (filledPasswordField) {
        const existing = await getPasswordsForDomain(domain);
        const alreadySaved = existing.some(e => e.password === filledPasswordField.suggestedValue);
        if (!alreadySaved) {
          const filledUsernameField = fieldsToFill.find(f => f.category === 'credential' && f.type !== 'password');
          setSavePrompt({
            username: filledUsernameField?.suggestedValue || '',
            password: filledPasswordField.suggestedValue,
            domain,
          });
          return; // stay on page to show prompt
        }
      }
      setTimeout(() => navigateTo('home'), 1000);

    } catch {
      setIsFilling(false);
    }
  };

  const handleSaveCredential = async () => {
    if (!savePrompt) return;
    setSavingCred(true);
    try {
      await addPassword({
        id: generateId(),
        domain: savePrompt.domain,
        username: savePrompt.username,
        password: savePrompt.password,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } finally {
      setSavingCred(false);
      setSavePrompt(null);
      navigateTo('home');
    }
  };

  const fillSingle = async (field: DetectedField) => {
    if (!field.suggestedValue || !tabId) return;
    await fillOne(tabId, field);
    await rememberAll([field], domain, 'fill').catch(() => {});
    setFields(prev => prev.map(f => f.id === field.id ? { ...f, status: 'filled' } : f));
  };

  const updateSuggestedValue = (id: string, value: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, suggestedValue: value, status: f.status === 'error' ? 'ready' : f.status } : f));
  };

  const skipField = (id: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, status: f.status === 'skipped' ? 'ready' : 'skipped' } : f));
  };

  const hasNoVaultEntry = (f: DetectedField) => isVaultField(f) && !f.suggestedValue && f.status === 'pending';

  // Fields grouped under the question or section they belong to. A 40-field
  // checkout reads as five short blocks instead of one endless column.
  const groups = useMemo(() => {
    const map = new Map<string, DetectedField[]>();
    for (const field of fields) {
      const { question } = splitLabel(field);
      const key = question || CATEGORY_CONFIG[field.category]?.label || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(field);
    }
    return Array.from(map.entries());
  }, [fields]);

  const readyCount = fields.filter(f => f.status === 'ready' && f.suggestedValue).length;
  const emptyCount = fields.filter(f => !f.suggestedValue && !isVaultField(f)).length;

  return (
    <div className="flex flex-col h-full -mx-4 -my-4 h-[calc(100%+2rem)] bg-[#09090b]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#27272a] bg-[#09090b]/95 backdrop-blur-md z-20 shrink-0">
        <button className="btn-ghost !p-2" onClick={() => navigateTo('home')} title="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="text-center leading-tight">
          <p className="font-semibold text-sm">Review &amp; fill</p>
          <p className="text-[11px] text-muted">
            {isGenerating ? 'thinking…' : `${readyCount} ready · ${fields.length} found`}
          </p>
        </div>
        <button className="btn-ghost !p-2" onClick={generateFills} disabled={isGenerating} title="Regenerate">
          <RefreshCw size={16} className={isGenerating ? 'animate-spin' : ''} />
        </button>
      </div>

      {generationError && (
        <div className="mx-3 mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start gap-2.5 shrink-0">
          <XCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-red-300 mb-0.5">AI engine error</p>
            <p className="text-[11px] text-red-300/80 break-words leading-relaxed">{generationError}</p>
          </div>
        </div>
      )}

      {!isGenerating && learnedCount > 0 && (
        <div className="mx-3 mt-3 px-3 py-2 bg-violet-500/10 border border-violet-500/25 rounded-xl flex items-center gap-2 shrink-0">
          <Brain size={13} className="text-violet-300 shrink-0" />
          <p className="text-[11px] text-violet-200">
            {learnedCount} answer{learnedCount === 1 ? '' : 's'} recalled from memory — no guessing needed.
          </p>
        </div>
      )}

      {/* Save credential prompt */}
      {savePrompt && (
        <div className="mx-3 mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl animate-slide-up shrink-0">
          <div className="flex items-center gap-2 mb-1">
            <Save size={13} className="text-blue-400 shrink-0" />
            <p className="text-xs font-semibold text-blue-200">Save this password to your vault?</p>
          </div>
          <p className="text-[11px] text-muted mb-3">
            {savePrompt.domain}{savePrompt.username ? ` — ${savePrompt.username}` : ''}
          </p>
          <div className="flex gap-2">
            <button className="btn-primary !py-1.5 !px-3 !text-xs flex-1" onClick={handleSaveCredential} disabled={savingCred}>
              {savingCred ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-ghost !py-1.5 !px-3" onClick={() => { setSavePrompt(null); navigateTo('home'); }}>
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Field list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {isGenerating ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card-static p-3.5" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="h-3.5 w-1/3 bg-[#27272a] rounded shimmer mb-2.5" />
                <div className="h-9 w-full bg-[#18181b] rounded-lg border border-[#27272a]" />
              </div>
            ))}
            <div className="text-center mt-6 flex flex-col items-center">
              <div className="w-9 h-9 rounded-full border-2 border-primary-500 border-t-transparent animate-spin mb-3" />
              <p className="text-sm font-semibold text-primary-300">Drafting your answers</p>
              <p className="text-xs text-muted mt-1">Using your profile, memory and this page's context</p>
            </div>
          </div>
        ) : (
          <div className="space-y-5 pb-24">
            {groups.map(([groupName, groupFields]) => (
              <section key={groupName} className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-light px-0.5 leading-snug">
                  {groupName}
                </h3>

                {groupFields.map((field) => {
                  const config = CATEGORY_CONFIG[field.category] || CATEGORY_CONFIG.other;
                  const isFilled = field.status === 'filled';
                  const isSkipped = field.status === 'skipped';
                  const vault = isVaultField(field);
                  const noEntry = hasNoVaultEntry(field);
                  const lowConfidence = showConfidence && field.source === 'ai' && field.confidence > 0 && field.confidence < 0.7;
                  const { label } = splitLabel(field);

                  return (
                    <div
                      key={field.id}
                      className={`glass-card p-3 transition-colors ${
                        isFilled ? 'border-green-500/40 bg-green-500/[0.06]' : isSkipped ? 'opacity-40' : vault ? 'border-primary-500/25' : ''
                      }`}
                      onMouseEnter={() => tabId && highlight(tabId, field, true)}
                      onMouseLeave={() => tabId && highlight(tabId, field, false)}
                    >
                      {/* Row 1: what the field is */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm leading-none shrink-0" style={{ color: config.color }} title={config.label}>
                            {config.icon}
                          </span>
                          <span className="text-[13px] font-medium leading-snug break-words" title={field.label || field.name}>
                            {label}
                          </span>
                          {field.required && <Asterisk size={10} className="text-red-400 shrink-0 mt-0.5" />}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {isFilled ? (
                            <span className="badge badge-green"><Check size={9} /> Filled</span>
                          ) : (
                            <>
                              {field.source === 'memory' && <span className="badge badge-violet" title="Remembered from a previous fill"><Brain size={9} /> Memory</span>}
                              {field.source === 'vault' && <span className="badge badge-blue"><Lock size={9} /> Vault</span>}
                              {lowConfidence && <span className="badge badge-amber" title={`AI confidence ${Math.round(field.confidence * 100)}%`}>Check</span>}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Row 2: the value, editable */}
                      <div className="relative group">
                        {field.tagName === 'textarea' || field.tagName === 'contenteditable' ? (
                          <textarea
                            className={`glass-textarea text-[13px] w-full leading-relaxed ${isFilled ? 'text-green-300' : ''} ${lowConfidence ? '!border-amber-500/50' : ''}`}
                            value={field.suggestedValue}
                            onChange={(e) => updateSuggestedValue(field.id, e.target.value)}
                            placeholder={noEntry ? (field.category === 'payment' ? 'No card in vault' : 'No credentials in vault') : 'Nothing to fill — type your own'}
                            disabled={isFilled}
                            rows={3}
                          />
                        ) : (
                          <input
                            type={vault && field.type === 'password' && !isFilled ? 'password' : 'text'}
                            className={`glass-input text-[13px] w-full ${isFilled ? 'text-green-300' : ''} ${lowConfidence ? '!border-amber-500/50' : ''}`}
                            value={field.suggestedValue}
                            onChange={(e) => updateSuggestedValue(field.id, e.target.value)}
                            placeholder={noEntry ? (field.category === 'payment' ? 'No card in vault' : 'No credentials in vault') : 'Nothing to fill — type your own'}
                            disabled={isFilled}
                            list={field.options ? `opts-${field.id}` : undefined}
                          />
                        )}
                        {field.options && (
                          <datalist id={`opts-${field.id}`}>
                            {field.options.map((o, i) => <option key={i} value={o} />)}
                          </datalist>
                        )}
                      </div>

                      {/* Row 3: per-field actions */}
                      {!isFilled && (
                        <div className="flex items-center justify-between mt-2 gap-2">
                          {noEntry ? (
                            <span className="text-[11px] text-amber-300/90 flex items-center gap-1">
                              <AlertTriangle size={10} />
                              {field.category === 'payment' ? 'No card saved' : 'No credentials saved'}
                            </span>
                          ) : (
                            <button className="text-[11px] text-muted hover:text-muted-light font-medium" onClick={() => skipField(field.id)}>
                              {isSkipped ? 'Include' : 'Skip'}
                            </button>
                          )}

                          {noEntry ? (
                            <button
                              className="text-[11px] text-primary-400 hover:underline font-medium"
                              onClick={() => navigateTo(field.category === 'payment' ? 'paymentVault' : 'passwordVault')}
                            >
                              Add to vault →
                            </button>
                          ) : field.suggestedValue && !isSkipped ? (
                            <button className="text-[11px] text-primary-400 hover:underline font-medium flex items-center gap-1" onClick={() => fillSingle(field)}>
                              <Sparkles size={10} /> Fill this
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}

            {emptyCount > 0 && (
              <p className="text-[11px] text-muted text-center leading-relaxed px-4">
                {emptyCount} field{emptyCount === 1 ? '' : 's'} came back empty. Add the missing details to your profile and they'll be answered next time.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Floating action footer */}
      {!isGenerating && readyCount > 0 && (
        <div className="absolute bottom-3 left-3 right-3 animate-slide-up">
          <div className="p-2.5 bg-[#18181b]/95 backdrop-blur-xl border border-primary-500/30 rounded-2xl shadow-[0_-6px_24px_rgba(0,0,0,0.7)]">
            {isFilling ? (
              <div className="flex flex-col items-center py-1">
                <div className="w-full bg-[#27272a] rounded-full h-1.5 mb-2 overflow-hidden">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs font-medium">Filling {progress.done} of {progress.total}…</span>
              </div>
            ) : (
              <button className="btn-primary w-full py-3" onClick={fillAll}>
                <Wand2 size={16} />
                <span>Fill {readyCount} field{readyCount === 1 ? '' : 's'}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
