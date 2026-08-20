import React, { useState, useEffect } from 'react';
import { Shield, Key, Bot, Settings2, Link2, RefreshCw, Brain } from 'lucide-react';
import type { Settings, Profile, ProviderConfig } from '../../shared/types';
import { saveSettings } from '../../shared/storage';
import { PROVIDERS, getProviderConfig } from '../../shared/constants';

interface SettingsProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  profiles: Profile[];
}

export default function SettingsPage({ settings, setSettings }: SettingsProps) {
  // Local state so typing in the key field doesn't write to storage per keystroke
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  // Model ids fetched live from the provider, so a model released today is
  // usable today without shipping a new build.
  const [liveModels, setLiveModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const commit = (next: Settings) => {
    setLocalSettings(next);
    setSettings(next);
    saveSettings(next);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const updateSetting = (key: keyof Settings, value: any) => {
    commit({ ...localSettings, [key]: value });
  };

  // Every provider shares one config shape, so one setter covers all of them.
  const updateProvider = (patch: Partial<ProviderConfig>, persist: boolean) => {
    const id = localSettings.aiProvider;
    const next = {
      ...localSettings,
      providers: {
        ...localSettings.providers,
        [id]: { ...current, ...patch },
      },
    } as Settings;
    persist ? commit(next) : setLocalSettings(next);
  };

  const handleToggle = (key: 'autoDetect' | 'showConfidence' | 'learnFromTyping' | 'useMemory') => {
    updateSetting(key, !localSettings[key]);
  };

  const refreshModels = async () => {
    setLoadingModels(true);
    setModelError(null);
    const id = localSettings.aiProvider;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LIST_MODELS', settings: localSettings });
      if (response?.error) throw new Error(response.error);
      if (!response?.models?.length) throw new Error('That provider returned no models.');
      setLiveModels((prev) => ({ ...prev, [id]: response.models }));
    } catch (err: any) {
      setModelError(err.message || 'Could not reach the provider.');
    } finally {
      setLoadingModels(false);
    }
  };

  const active = getProviderConfig(localSettings);
  const spec = active.spec;
  const current: ProviderConfig = {
    apiKey: localSettings.providers?.[localSettings.aiProvider]?.apiKey ?? '',
    model: localSettings.providers?.[localSettings.aiProvider]?.model ?? '',
    baseUrl: localSettings.providers?.[localSettings.aiProvider]?.baseUrl ?? '',
  };

  return (
    <div className="flex flex-col h-full space-y-5 pt-1 pb-6 overflow-y-auto pr-1">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white tracking-tight leading-none">Settings</h2>
        {isSaved && <span className="text-[10px] text-primary-400 font-medium animate-fade-in bg-primary-500/10 px-2 py-1 rounded">Saved</span>}
      </div>

      {/* AI Provider Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Bot size={16} className="text-primary-400" />
          <h3 className="text-sm font-semibold tracking-wide">AI Provider</h3>
        </div>

        <select
          className="glass-input cursor-pointer"
          value={localSettings.aiProvider}
          onChange={(e) => updateSetting('aiProvider', e.target.value)}
        >
          {Object.entries(PROVIDERS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.name}{localSettings.providers?.[id]?.apiKey ? ' ✓' : ''}
            </option>
          ))}
        </select>

        <div className="glass-card-static p-4 space-y-4 animate-slide-up">
          {spec.note && (
            <p className="text-[10px] text-muted-light leading-relaxed bg-primary-500/5 border border-primary-500/15 rounded-lg p-2.5">
              {spec.note}
            </p>
          )}

          {/* Base URL — only for endpoints that aren't fixed */}
          {spec.editableBaseUrl && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-light font-medium">API Base URL</label>
              <div className="relative">
                <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  className="glass-input !pl-8"
                  placeholder={spec.baseUrl || 'https://api.example.com/v1'}
                  value={current.baseUrl || ''}
                  onChange={(e) => updateProvider({ baseUrl: e.target.value }, false)}
                  onBlur={(e) => updateProvider({ baseUrl: e.target.value.trim() }, true)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs text-muted-light font-medium flex items-center justify-between">
              <span>{spec.name} API Key</span>
              {spec.keyUrl && (
                <a href={spec.keyUrl} target="_blank" rel="noreferrer" className="text-[10px] text-primary-400 hover:underline">
                  Get key →
                </a>
              )}
            </label>
            <div className="relative">
              <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="password"
                className="glass-input !pl-8"
                placeholder={spec.keyPlaceholder || 'API key'}
                value={current.apiKey}
                onChange={(e) => updateProvider({ apiKey: e.target.value }, false)}
                onBlur={(e) => updateProvider({ apiKey: e.target.value.trim() }, true)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-light font-medium flex items-center justify-between">
              <span>Model</span>
              <button
                className="text-[11px] text-primary-400 hover:underline font-medium flex items-center gap-1 disabled:opacity-50"
                onClick={refreshModels}
                disabled={loadingModels || !current.apiKey}
                title="Fetch the provider's current model list"
              >
                <RefreshCw size={10} className={loadingModels ? 'animate-spin' : ''} />
                {loadingModels ? 'Loading…' : 'Refresh list'}
              </button>
            </label>
            {/* Free text with suggestions: OpenRouter and NIM expose hundreds of
                model ids, so a fixed dropdown would lock most of them out. */}
            <input
              type="text"
              className="glass-input"
              list={`models-${localSettings.aiProvider}`}
              placeholder={spec.models[0] || 'model id'}
              value={current.model}
              onChange={(e) => updateProvider({ model: e.target.value }, false)}
              onBlur={(e) => updateProvider({ model: e.target.value.trim() }, true)}
            />
            <datalist id={`models-${localSettings.aiProvider}`}>
              {(liveModels[localSettings.aiProvider] ?? spec.models).map((m) => <option key={m} value={m} />)}
            </datalist>
            {modelError && <p className="text-[11px] text-amber-400">{modelError}</p>}
            {liveModels[localSettings.aiProvider] && (
              <p className="text-[11px] text-muted">{liveModels[localSettings.aiProvider].length} models live from {spec.name}.</p>
            )}
          </div>

          <div className="flex bg-[#18181b]/80 p-3 rounded-lg border border-[#27272a] items-start gap-3 mt-4">
            <Shield size={16} className="text-green-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-light leading-relaxed">
              Your key is stored locally and sent only to {spec.name}
              {active.baseUrl ? ` (${active.baseUrl})` : ''}. Nothing routes through us.
            </p>
          </div>
        </div>
      </div>

      <div className="divider"></div>

      {/* Extension Behavior */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Settings2 size={16} className="text-primary-400" />
          <h3 className="text-sm font-semibold tracking-wide">Behavior</h3>
        </div>

        <div className="glass-card-static p-4 space-y-4">
          <Toggle
            on={localSettings.autoDetect}
            onClick={() => handleToggle('autoDetect')}
            title="Auto-detect forms"
            hint="Scan the page the moment the popup opens"
          />
          <div className="h-px w-full bg-[#27272a]" />
          <Toggle
            on={localSettings.showConfidence}
            onClick={() => handleToggle('showConfidence')}
            title="Flag uncertain answers"
            hint="Mark predictions the model isn't sure about"
          />
        </div>
      </div>

      <div className="divider" />

      {/* Learning */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain size={16} className="text-violet-400" />
          <h3 className="text-sm font-semibold tracking-wide">Learning</h3>
        </div>

        <div className="glass-card-static p-4 space-y-4">
          <Toggle
            on={localSettings.useMemory}
            onClick={() => handleToggle('useMemory')}
            title="Reuse what I've answered before"
            hint="Remembered answers are used first — instant and free"
          />
          <div className="h-px w-full bg-[#27272a]" />
          <Toggle
            on={localSettings.learnFromTyping}
            onClick={() => handleToggle('learnFromTyping')}
            title="Learn from what I type"
            hint="Values you type into forms yourself become memory too"
          />
          <p className="text-[11px] text-muted-light leading-relaxed bg-violet-500/5 border border-violet-500/15 rounded-lg p-2.5">
            Passwords, card numbers, CVVs and anything matching a secret are filtered out before anything is
            written. Review or delete every learned fact on the Memory tab.
          </p>
        </div>
      </div>

      <div className="space-y-2 mt-auto pt-6 opacity-60 hover:opacity-100 transition-opacity">
        <p className="text-[11px] text-center text-muted">
          FormPilot v{chrome?.runtime?.getManifest?.().version ?? '1.1.0'} — updates install automatically
        </p>
        <div className="flex justify-center gap-4 text-[11px] text-primary-400 font-medium">
          <a href="/privacy.html" target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
          <a href="#" className="hover:underline">Documentation</a>
        </div>
      </div>
    </div>
  );
}

function Toggle({ on, onClick, title, hint }: { on: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button className="flex items-center justify-between gap-3 w-full text-left" onClick={onClick} role="switch" aria-checked={on}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-white leading-tight">{title}</p>
        <p className="text-[11px] text-muted mt-0.5 leading-snug">{hint}</p>
      </div>
      <div className={`toggle-track shrink-0 ${on ? 'active' : ''}`}>
        <div className="toggle-thumb" />
      </div>
    </button>
  );
}
