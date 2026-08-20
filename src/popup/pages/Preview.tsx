import React, { useState, useEffect } from 'react';
import { ArrowLeft, Wand2, RefreshCw, XCircle, Lock, AlertTriangle, Save, X } from 'lucide-react';
import type { DetectedField, Profile, Page } from '../../shared/types';
import {
  getSettings, addHistoryEntry, generateId,
  getPaymentCards, getPasswordsForDomain, addPassword,
} from '../../shared/storage';
import { CATEGORY_CONFIG, PAYMENT_FIELD_PATTERNS } from '../../shared/constants';

interface PreviewProps {
  fields: DetectedField[];
  setFields: React.Dispatch<React.SetStateAction<DetectedField[]>>;
  navigateTo: (page: Page) => void;
  activeProfile: Profile;
  activeTabUrl: string;
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

export default function Preview({ fields, setFields, navigateTo, activeProfile, activeTabUrl }: PreviewProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isFilling, setIsFilling] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [savePrompt, setSavePrompt] = useState<{ username: string; password: string; domain: string } | null>(null);
  const [savingCred, setSavingCred] = useState(false);
  const [showConfidence, setShowConfidence] = useState(true);

  const domain = (() => { try { return new URL(activeTabUrl).hostname; } catch { return ''; } })();

  useEffect(() => {
    const needsGeneration = fields.some(f => f.status === 'pending' && !f.suggestedValue);
    if (needsGeneration && !isGenerating) generateFills();
  }, []);

  const generateFills = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setSavePrompt(null);

    try {
      const settings = await getSettings();
      setShowConfidence(settings.showConfidence);

      const [aiResponse, cards, domainPasswords] = await Promise.all([
        Promise.race([
          chrome.runtime.sendMessage({
            type: 'GENERATE_FILLS',
            payload: { fields, profile: activeProfile, settings },
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

      setFields(prev => prev.map((f, i) => {
        // Payment fields — fill from default vault card
        if (f.category === 'payment') {
          if (defaultCard) {
            const value = getCardValueForField(f, defaultCard);
            return { ...f, suggestedValue: value, confidence: 1.0, status: value ? 'ready' : 'pending' };
          }
          return { ...f, suggestedValue: '', status: 'pending' };
        }

        // Credential fields — fill from vault entry for this domain
        if (f.category === 'credential') {
          if (domainCred) {
            const value = f.type === 'password' ? domainCred.password : domainCred.username;
            return { ...f, suggestedValue: value, confidence: 1.0, status: 'ready' };
          }
          return { ...f, suggestedValue: '', status: 'pending' };
        }

        // Non-sensitive fields — use AI suggestion (background remapped indices back to original)
        const suggestion = (aiResponse.suggestions ?? []).find((s: any) => s.index === i);
        if (suggestion) {
          return { ...f, suggestedValue: suggestion.value, confidence: suggestion.confidence, status: 'ready' };
        }
        return { ...f, status: 'error' };
      }));

    } catch (err: any) {
      setGenerationError(err.message || 'Failed to generate responses. Please check your API key in Settings.');
      setFields(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'error' } : f));
    } finally {
      setIsGenerating(false);
    }
  };

  const fillAll = async () => {
    setIsFilling(true);
    const fieldsToFill = fields.filter(f => f.status === 'ready' && f.suggestedValue);
    setProgress({ done: 0, total: fieldsToFill.length });

    try {
      if (!chrome?.tabs) throw new Error('Not running in extension');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      let filledCount = 0;
      for (const field of fieldsToFill) {
        await chrome.tabs.sendMessage(tab.id!, {
          type: 'FILL_FIELD',
          fieldId: field.fieldId,
          selector: field.selector,
          fallbackSelector: field.fallbackSelector,
          value: field.suggestedValue,
          tagName: field.tagName,
        });
        filledCount++;
        setProgress({ done: filledCount, total: fieldsToFill.length });
        setFields(prev => prev.map(f => f.id === field.id ? { ...f, status: 'filled' } : f));
        await new Promise(r => setTimeout(r, 150));
      }

      if (filledCount > 0) {
        try {
          await addHistoryEntry({
            id: generateId(),
            domain,
            url: activeTabUrl,
            title: tab.title || domain,
            profileId: activeProfile.id,
            profileName: activeProfile.name,
            fieldCount: fields.length,
            filledCount,
            // Card numbers and passwords stay in the vault — history is a plain
            // storage record that the History page renders in clear text.
            fields: fields.filter(f => f.status === 'filled').map(f => ({
              label: f.label || f.name,
              value: isVaultField(f) ? '••••••••' : f.suggestedValue,
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

    } catch (err) {
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
    if (!field.suggestedValue) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id!, {
        type: 'FILL_FIELD',
        fieldId: field.fieldId,
        selector: field.selector,
        fallbackSelector: field.fallbackSelector,
        value: field.suggestedValue,
        tagName: field.tagName,
      });
      setFields(prev => prev.map(f => f.id === field.id ? { ...f, status: 'filled' } : f));
    } catch (err) {
      console.error('Single fill error:', err);
    }
  };

  const handleHover = (selector: string, isEntering: boolean) => {
    if (chrome?.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          if (isEntering) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'HIGHLIGHT_FIELDS', selectors: [selector] }).catch(() => {});
          } else {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_HIGHLIGHTS' }).catch(() => {});
          }
        }
      });
    }
  };

  const updateSuggestedValue = (id: string, value: string) => {
    setFields(prev => prev.map(f => f.id === id ? { ...f, suggestedValue: value } : f));
  };

  const isVaultField = (f: DetectedField) => f.category === 'payment' || f.category === 'credential';
  const hasNoVaultEntry = (f: DetectedField) => isVaultField(f) && !f.suggestedValue && f.status === 'pending';

  return (
    <div className="flex flex-col h-full -mx-4 -my-4 h-[calc(100%+2rem)] bg-[#080F1E]">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[rgba(255,255,255,0.09)] sticky top-0 bg-[#080F1E]/95 backdrop-blur-md z-20">
        <button className="btn-ghost !p-2 -ml-2" onClick={() => navigateTo('home')}>
          <ArrowLeft size={18} />
        </button>
        <span className="font-semibold text-sm">Review Predictions</span>
        <button className="btn-ghost !p-2 -mr-2" onClick={generateFills} disabled={isGenerating}>
          <RefreshCw size={16} className={isGenerating ? 'animate-spin' : ''} />
        </button>
      </div>

      {generationError && (
        <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
          <XCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-red-500 mb-0.5">AI Engine Error</span>
            <span className="text-[10px] text-red-400 break-words">{generationError}</span>
          </div>
        </div>
      )}

      {/* Save credential prompt */}
      {savePrompt && (
        <div className="mx-4 mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg animate-slide-up">
          <div className="flex items-center gap-2 mb-1">
            <Save size={13} className="text-blue-400 shrink-0" />
            <p className="text-xs font-semibold text-blue-300">Save this password to vault?</p>
          </div>
          <p className="text-[10px] text-muted mb-3">
            {savePrompt.domain}{savePrompt.username ? ` — ${savePrompt.username}` : ''}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-primary !py-1.5 !px-3 !text-xs flex-1"
              onClick={handleSaveCredential}
              disabled={savingCred}
            >
              {savingCred ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn-ghost !py-1.5 !px-3"
              onClick={() => { setSavePrompt(null); navigateTo('home'); }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Field list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {isGenerating ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card-static p-4 animate-slide-up" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="flex justify-between mb-2">
                  <div className="h-4 w-1/3 bg-[#112035] rounded shimmer"></div>
                  <div className="h-4 w-1/6 bg-[#112035] rounded shimmer"></div>
                </div>
                <div className="h-8 w-full bg-[#0D1829] rounded border border-[rgba(255,255,255,0.09)]"></div>
              </div>
            ))}
            <div className="text-center mt-6 flex flex-col items-center">
              <div className="w-10 h-10 rounded-full border-2 border-primary-500 border-t-transparent animate-spin mb-3"></div>
              <p className="text-sm font-medium text-primary-400">AI is drafting responses…</p>
              <p className="text-xs text-muted mt-1">Analyzing context and constraints</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-20">
            {fields.map((field) => {
              const config = CATEGORY_CONFIG[field.category] || CATEGORY_CONFIG.other;
              const isFilled = field.status === 'filled';
              const isReady = field.status === 'ready';
              const vault = isVaultField(field);
              const noEntry = hasNoVaultEntry(field);

              return (
                <div
                  key={field.id}
                  className={`glass-card p-3 transition-colors ${isFilled ? 'border-green-500/30 bg-green-500/5' : vault ? 'border-primary-500/20' : ''}`}
                  onMouseEnter={() => handleHover(field.selector, true)}
                  onMouseLeave={() => handleHover(field.selector, false)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2 max-w-[70%]">
                      <span className="text-[10px] text-muted-dark uppercase font-semibold">
                        {config.icon} {config.label}
                      </span>
                      <span className="text-xs font-medium truncate" title={field.label || field.name}>
                        {field.label || field.name || 'Unnamed Field'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {vault && !isFilled && (
                        <span className="badge badge-blue !text-[9px]">🔒 Vault</span>
                      )}
                      {showConfidence && !vault && field.confidence > 0 && field.confidence < 0.7 && (
                        <span className="badge badge-amber !text-[9px]">Low Conf</span>
                      )}
                      {isFilled && <span className="badge badge-green !text-[9px]">Filled</span>}
                    </div>
                  </div>

                  <div className="relative group">
                    {field.tagName === 'textarea' ? (
                      <textarea
                        className={`glass-textarea text-sm w-full font-medium ${isFilled ? 'text-green-400' : 'text-primary-100'} ${showConfidence && !vault && field.confidence < 0.7 ? 'border-amber-500/50' : ''}`}
                        value={field.suggestedValue}
                        onChange={(e) => updateSuggestedValue(field.id, e.target.value)}
                        placeholder={noEntry ? (field.category === 'payment' ? 'No card in vault' : 'No credentials in vault') : 'Missing value…'}
                        disabled={isFilled}
                        rows={3}
                      />
                    ) : (
                      <input
                        type={vault && field.type === 'password' && !isFilled ? 'password' : 'text'}
                        className={`glass-input text-sm w-full font-medium ${isFilled ? 'text-green-400' : 'text-primary-100'} ${showConfidence && !vault && field.confidence < 0.7 ? 'border-amber-500/50' : ''}`}
                        value={field.suggestedValue}
                        onChange={(e) => updateSuggestedValue(field.id, e.target.value)}
                        placeholder={noEntry ? (field.category === 'payment' ? 'No card in vault' : 'No credentials in vault') : 'Missing value…'}
                        disabled={isFilled}
                      />
                    )}

                    {!isFilled && isReady && field.suggestedValue && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary-600 hover:bg-primary-500 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => fillSingle(field)}
                        title="Fill this field only"
                      >
                        <Lock size={14} />
                      </button>
                    )}
                  </div>

                  {/* From Vault label */}
                  {vault && !noEntry && !isFilled && (
                    <p className="text-[10px] text-primary-400/60 mt-1 flex items-center gap-1">
                      <Lock size={9} /> From Vault
                    </p>
                  )}

                  {/* No vault entry warning */}
                  {noEntry && (
                    <div className="mt-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-amber-400 flex items-center gap-1">
                        <AlertTriangle size={10} />
                        {field.category === 'payment' ? 'No card saved' : 'No credentials saved'}
                      </span>
                      <button
                        className="text-[10px] text-primary-400 hover:underline font-medium"
                        onClick={() => navigateTo(field.category === 'payment' ? 'paymentVault' : 'passwordVault')}
                      >
                        Add to vault →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating action footer */}
      {!isGenerating && fields.some(f => f.status === 'ready' && f.suggestedValue) && (
        <div className="absolute bottom-4 left-4 right-4 animate-slide-up blur-backdrop">
          <div className="p-3 bg-surface-100/90 backdrop-blur-xl border border-primary-500/30 rounded-xl shadow-[0_-5px_20px_rgba(9,9,11,0.8)]">
            {isFilling ? (
              <div className="flex flex-col items-center py-1">
                <div className="w-full bg-[#112035] rounded-full h-1.5 mb-2 overflow-hidden">
                  <div
                    className="bg-primary-500 h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                  ></div>
                </div>
                <span className="text-xs font-medium animate-pulse">Filling {progress.done} of {progress.total}…</span>
              </div>
            ) : (
              <button className="btn-primary w-full py-3" onClick={fillAll}>
                <Wand2 size={16} />
                <span>Auto-Fill All Forms</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
