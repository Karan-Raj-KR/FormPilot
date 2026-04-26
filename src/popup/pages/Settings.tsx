import React, { useState, useEffect } from 'react';
import { Shield, Key, Bot, Settings2 } from 'lucide-react';
import type { Settings, Profile } from '../../shared/types';
import { saveSettings } from '../../shared/storage';
import { OPENAI_MODELS, ANTHROPIC_MODELS, GEMINI_MODELS, GROQ_MODELS } from '../../shared/constants';

interface SettingsProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  profiles: Profile[];
}

export default function SettingsPage({ settings, setSettings, profiles }: SettingsProps) {
  // Local state for debouncing API key inputs
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const updateSetting = (key: keyof Settings, value: any) => {
    const nextSettings = { ...localSettings, [key]: value };
    setLocalSettings(nextSettings);
    setSettings(nextSettings);
    saveSettings(nextSettings);
    
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleToggle = (key: 'autoDetect' | 'showConfidence') => {
    updateSetting(key, !localSettings[key]);
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
        
        <div className="bg-[#18181b]/50 rounded-xl p-1 flex">
          <button 
            className={`flex-1 py-1.5 px-0.5 text-[11px] font-semibold rounded-lg transition-colors ${localSettings.aiProvider === 'openai' ? 'bg-[#27272a] shadow-sm text-white' : 'text-muted hover:text-muted-light'}`}
            onClick={() => updateSetting('aiProvider', 'openai')}
          >
            ChatGPT
          </button>
          <button 
            className={`flex-1 py-1.5 px-0.5 text-[11px] font-semibold rounded-lg transition-colors ${localSettings.aiProvider === 'anthropic' ? 'bg-[#27272a] shadow-sm text-white' : 'text-muted hover:text-muted-light'}`}
            onClick={() => updateSetting('aiProvider', 'anthropic')}
          >
            Claude
          </button>
          <button 
            className={`flex-1 py-1.5 px-0.5 text-[11px] font-semibold rounded-lg transition-colors ${localSettings.aiProvider === 'gemini' ? 'bg-[#27272a] shadow-sm text-white' : 'text-muted hover:text-muted-light'}`}
            onClick={() => updateSetting('aiProvider', 'gemini')}
          >
            Gemini
          </button>
          <button 
            className={`flex-1 py-1.5 px-0.5 text-[11px] font-semibold rounded-lg transition-colors ${localSettings.aiProvider === 'groq' ? 'bg-[#27272a] shadow-sm text-white' : 'text-muted hover:text-muted-light'}`}
            onClick={() => updateSetting('aiProvider', 'groq')}
          >
            Groq
          </button>
        </div>

        {/* Provider Specific Config */}
        <div className="glass-card-static p-4 space-y-4 animate-slide-up">
          {localSettings.aiProvider === 'openai' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium flex items-center justify-between">
                  <span>OpenAI API Key</span>
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[10px] text-primary-400 hover:underline">Get key →</a>
                </label>
                <div className="relative">
                  <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input 
                    type="password" 
                    className="glass-input !pl-8" 
                    placeholder="sk-..." 
                    value={localSettings.openaiApiKey}
                    onChange={(e) => {
                      setLocalSettings({...localSettings, openaiApiKey: e.target.value});
                    }}
                    onBlur={(e) => updateSetting('openaiApiKey', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium">Model Selection</label>
                <select 
                  className="glass-input cursor-pointer"
                  value={localSettings.openaiModel}
                  onChange={(e) => updateSetting('openaiModel', e.target.value)}
                >
                  {OPENAI_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.description}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {localSettings.aiProvider === 'anthropic' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium flex items-center justify-between">
                  <span>Anthropic API Key</span>
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-[10px] text-primary-400 hover:underline">Get key →</a>
                </label>
                <div className="relative">
                  <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input 
                    type="password" 
                    className="glass-input !pl-8" 
                    placeholder="sk-ant-..." 
                    value={localSettings.anthropicApiKey}
                    onChange={(e) => setLocalSettings({...localSettings, anthropicApiKey: e.target.value})}
                    onBlur={(e) => updateSetting('anthropicApiKey', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium">Model Selection</label>
                <select 
                  className="glass-input cursor-pointer"
                  value={localSettings.anthropicModel}
                  onChange={(e) => updateSetting('anthropicModel', e.target.value)}
                >
                  {ANTHROPIC_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.description}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {localSettings.aiProvider === 'gemini' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium flex items-center justify-between">
                  <span>Gemini API Key</span>
                  <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[10px] text-primary-400 hover:underline">Get key →</a>
                </label>
                <div className="relative">
                  <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input 
                    type="password" 
                    className="glass-input !pl-8" 
                    placeholder="AIzaSy..." 
                    value={localSettings.geminiApiKey || ''}
                    onChange={(e) => setLocalSettings({...localSettings, geminiApiKey: e.target.value})}
                    onBlur={(e) => updateSetting('geminiApiKey', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium">Model Selection</label>
                <select 
                  className="glass-input cursor-pointer"
                  value={localSettings.geminiModel || 'gemini-2.5-flash'}
                  onChange={(e) => updateSetting('geminiModel', e.target.value)}
                >
                  {GEMINI_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.description}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {localSettings.aiProvider === 'groq' && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium flex items-center justify-between">
                  <span>Groq API Key</span>
                  <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-[10px] text-primary-400 hover:underline">Get key →</a>
                </label>
                <div className="relative">
                  <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input 
                    type="password" 
                    className="glass-input !pl-8" 
                    placeholder="gsk_..." 
                    value={localSettings.groqApiKey || ''}
                    onChange={(e) => setLocalSettings({...localSettings, groqApiKey: e.target.value})}
                    onBlur={(e) => updateSetting('groqApiKey', e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-light font-medium">Model Selection</label>
                <select 
                  className="glass-input cursor-pointer"
                  value={localSettings.groqModel || 'llama-3.3-70b-versatile'}
                  onChange={(e) => updateSetting('groqModel', e.target.value)}
                >
                  {GROQ_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name} — {m.description}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="flex bg-[#18181b]/80 p-3 rounded-lg border border-[#27272a] items-start gap-3 mt-4">
            <Shield size={16} className="text-green-500 shrink-0 mt-0.5" />
            <p className="text-[10px] text-muted-light leading-relaxed">
              Your API key is stored locally in your browser's encrypted storage and is only sent directly to {localSettings.aiProvider === 'openai' ? 'OpenAI' : localSettings.aiProvider === 'gemini' ? 'Google' : localSettings.aiProvider === 'groq' ? 'Groq' : 'Anthropic'}. Zero tracking.
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
          <div className="flex items-center justify-between cursor-pointer" onClick={() => handleToggle('autoDetect')}>
            <div>
              <p className="text-sm font-medium text-white">Auto-detect forms</p>
              <p className="text-[10px] text-muted">Scan page automatically when popup opens</p>
            </div>
            <div className={`toggle-track ${localSettings.autoDetect ? 'active' : ''}`}>
              <div className="toggle-thumb"></div>
            </div>
          </div>
          
          <div className="h-px w-full bg-[#27272a]"></div>

          <div className="flex items-center justify-between cursor-pointer" onClick={() => handleToggle('showConfidence')}>
            <div>
              <p className="text-sm font-medium text-white">Show confidence scores</p>
              <p className="text-[10px] text-muted">Highlight low-confidence AI predictions</p>
            </div>
            <div className={`toggle-track ${localSettings.showConfidence ? 'active' : ''}`}>
              <div className="toggle-thumb"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 mt-auto pt-6 opacity-60 hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-center text-muted">FormPilot v1.0.0</p>
        <div className="flex justify-center gap-4 text-[10px] text-primary-400 font-medium">
          <a href="/privacy.html" target="_blank" rel="noreferrer" className="hover:underline">Privacy Policy</a>
          <a href="#" className="hover:underline">Documentation</a>
        </div>
      </div>
    </div>
  );
}
