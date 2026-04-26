import React, { useState, useRef } from 'react';
import { Plus, Edit2, Trash2, CheckCircle2, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import type { Profile, Settings } from '../../shared/types';
import { addProfile, updateProfile, deleteProfile, saveSettings, generateId } from '../../shared/storage';
import { EMPTY_PROFILE_DATA, PROFILE_COLORS, PROFILE_EMOJIS, TONE_OPTIONS, LENGTH_OPTIONS } from '../../shared/constants';

interface ProfilesProps {
  profiles: Profile[];
  setProfiles: React.Dispatch<React.SetStateAction<Profile[]>>;
  activeProfileId: string;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

export default function Profiles({ profiles, setProfiles, activeProfileId, setSettings }: ProfilesProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'basic' | 'professional' | 'social' | 'links' | ''>('basic');
  
  // Form state
  const [formData, setFormData] = useState<Partial<Profile>>({});
  
  const scrollView = useRef<HTMLDivElement>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  const LLM_CONTEXT_PROMPT = `Please compile everything you know about me into a structured personal profile. Include all of the following that you know:\n\n- Full name\n- Email address\n- Phone number\n- Home address (street, city, state, zip, country)\n- Current job title and company\n- Years of experience\n- Key skills (comma-separated)\n- A 2–3 sentence professional bio\n- Work experience highlights (role, company, brief description)\n- Education (degree, institution, year)\n- Notable projects (name + one-line description)\n- LinkedIn URL\n- GitHub URL\n- Personal website\n- Any other relevant personal or professional information\n\nFormat it as clean plain text — no markdown, no headers — so I can paste it directly into a form-filling assistant.`;

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(LLM_CONTEXT_PROMPT);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2500);
  };

  const startEdit = (profile: Profile) => {
    setFormData(JSON.parse(JSON.stringify(profile)));
    setEditingId(profile.id);
    setIsCreating(false);
    setTimeout(() => scrollView.current?.scrollTo(0, 0), 10);
  };

  const startCreate = () => {
    setFormData({
      name: 'New Profile',
      color: PROFILE_COLORS[profiles.length % PROFILE_COLORS.length],
      emoji: PROFILE_EMOJIS[profiles.length % PROFILE_EMOJIS.length],
      data: { ...EMPTY_PROFILE_DATA },
      tonePreference: 'professional',
      lengthPreference: 'moderate'
    });
    setEditingId(null);
    setIsCreating(true);
    setTimeout(() => scrollView.current?.scrollTo(0, 0), 10);
  };

  const saveForm = async () => {
    if (isCreating) {
      const newProfile: Profile = {
        ...(formData as Profile),
        id: generateId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = await addProfile(newProfile);
      setProfiles(updated);
      
      // Auto switch if first custom profile
      if (updated.length === 1 || (updated.length === 3 && activeProfileId === 'personal')) {
        await setActiveProfile(newProfile.id);
      }
    } else if (editingId) {
      const updatedProfile = { ...formData, id: editingId, updatedAt: Date.now() } as Profile;
      const updated = await updateProfile(updatedProfile);
      setProfiles(updated);
    }
    
    setEditingId(null);
    setIsCreating(false);
  };

  const removeProfile = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this profile?')) {
      const updated = await deleteProfile(id);
      setProfiles(updated);
      if (activeProfileId === id && updated.length > 0) {
        await setActiveProfile(updated[0].id);
      }
    }
  };

  const setActiveProfile = async (id: string) => {
    setSettings(prev => {
      const newSettings = { ...prev, activeProfileId: id };
      saveSettings(newSettings);
      return newSettings;
    });
  };

  const updateDataField = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      data: { ...prev.data, [field]: value } as any
    }));
  };

  // Render list view
  if (!editingId && !isCreating) {
    return (
      <div className="flex flex-col h-full space-y-4 pt-1">
        <h2 className="text-xl font-bold text-white tracking-tight mb-2">My Profiles</h2>
        
        <div className="space-y-3 flex-1 overflow-y-auto pb-4 pr-1">
          {profiles.map((profile, i) => {
            const isActive = profile.id === activeProfileId;
            return (
              <div 
                key={profile.id} 
                onClick={() => setActiveProfile(profile.id)}
                className={`glass-card p-3 flex items-center gap-3 cursor-pointer stagger-${i+1} animate-slide-up group ${
                  isActive ? 'border-primary-500/50 bg-[#18181b]/80' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 transition-transform group-hover:scale-110" style={{ backgroundColor: `${profile.color}20`, color: profile.color }}>
                  {profile.emoji}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className={`font-semibold truncate ${isActive ? 'text-primary-400' : 'text-white'}`}>
                      {profile.name}
                    </h3>
                    {isActive && <CheckCircle2 size={14} className="text-primary-500" />}
                  </div>
                  <p className="text-xs text-muted truncate mt-0.5">
                    {profile.data?.bio ? profile.data.bio.substring(0, 40) + '...' : 'No bio set'}
                  </p>
                </div>
                
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="btn-ghost !p-1.5" onClick={(e) => { e.stopPropagation(); startEdit(profile); }}>
                    <Edit2 size={14} />
                  </button>
                  {profiles.length > 1 && (
                    <button className="btn-ghost !p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={(e) => removeProfile(profile.id, e)}>
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <button className="btn-secondary w-full py-3" onClick={startCreate}>
          <Plus size={16} />
          <span>Create Profile</span>
        </button>
      </div>
    );
  }

  // Render edit form
  return (
    <div className="flex flex-col h-full -mx-4 -my-4 h-[calc(100%+2rem)] bg-[#09090b]" ref={scrollView}>
      <div className="flex items-center justify-between p-4 border-b border-[#27272a] sticky top-0 bg-[#09090b]/95 backdrop-blur-md z-20">
        <button className="btn-ghost" onClick={() => { setEditingId(null); setIsCreating(false); }}>Cancel</button>
        <span className="font-semibold text-sm">{isCreating ? 'New Profile' : 'Edit Profile'}</span>
        <button className="btn-primary !px-3 !py-1.5" onClick={saveForm}>Save</button>
      </div>

      <div className="p-4 space-y-6 overflow-y-auto pb-8">
        {/* Identity config */}
        <div className="flex items-end gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-2xl shrink-0 border border-[#27272a]" style={{ backgroundColor: `${formData.color}20` }}>
            {formData.emoji}
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">Profile Name</label>
            <input 
              className="glass-input !bg-transparent !border-b !border-0 !border-b-[#27272a] !rounded-none !px-0 focus:!border-b-primary-500" 
              value={formData.name || ''} 
              onChange={e => setFormData({...formData, name: e.target.value})}
            />
          </div>
        </div>

        {/* Tone & Length Preferences */}
        <div className="space-y-3">
          <label className="text-[10px] uppercase font-bold text-muted-dark tracking-wider">AI Writing Style</label>
          <div className="grid grid-cols-2 gap-2">
            <select 
              className="glass-input cursor-pointer"
              value={formData.tonePreference}
              onChange={e => setFormData({...formData, tonePreference: e.target.value as any})}
            >
              {TONE_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.icon} {opt.label}</option>)}
            </select>
            <select 
              className="glass-input cursor-pointer"
              value={formData.lengthPreference}
              onChange={e => setFormData({...formData, lengthPreference: e.target.value as any})}
            >
              {LENGTH_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.icon} {opt.label}</option>)}
            </select>
          </div>
        </div>

        {/* Section: Raw Info (Direct AI Parsing) */}
        <div className="glass-card-static rounded-lg overflow-hidden">
          <button 
            className="w-full flex items-center justify-between p-3 bg-[#18181b]/50"
            onClick={() => setExpandedSection(expandedSection === 'basic' ? '' : 'basic')}
          >
            <div className="flex flex-col items-start gap-0.5">
              <span className="font-semibold text-sm">Raw Content / "About Me"</span>
              <span className="text-[10px] text-primary-400">Paste anything from ChatGPT/Claude directly here!</span>
            </div>
            {expandedSection === 'basic' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          
          {expandedSection === 'basic' && (
            <div className="p-3 space-y-3 border-t border-[#27272a]">
              {/* Prompt helper */}
              <div className="rounded-lg border border-primary-500/20 bg-primary-500/5 p-2.5 space-y-2">
                <p className="text-[10px] text-muted-light leading-relaxed">
                  Don't have your info ready? Copy this prompt and paste it into{' '}
                  <span className="text-primary-400 font-medium">ChatGPT, Claude, or Gemini</span>
                  {' '}— then paste the result below.
                </p>
                <button
                  onClick={copyPrompt}
                  className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-md transition-all ${
                    promptCopied
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-primary-500/15 text-primary-400 border border-primary-500/25 hover:bg-primary-500/25'
                  }`}
                >
                  {promptCopied ? <Check size={11} /> : <Copy size={11} />}
                  {promptCopied ? 'Prompt copied!' : 'Copy prompt for any LLM'}
                </button>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-light">Everything about you (Resume, Biography, Custom Instructions, etc)</label>
                <textarea 
                  className="glass-textarea !min-h-[120px] font-mono text-[11px]" 
                  value={formData.data?.rawInfo || ''} 
                  onChange={e => updateDataField('rawInfo', e.target.value)} 
                  placeholder="Paste your raw information directly from Claude, ChatGPT, or your Resume here... The AI will instantly search this any time a form asks for something." 
                />
              </div>
            </div>
          )}
        </div>

        {/* Data Sections */}
        <div className="space-y-2">
          {/* Section: Basic Info */}
          <div className="glass-card-static rounded-lg overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-3 bg-[#18181b]/50"
              onClick={() => setExpandedSection(expandedSection === 'professional' ? '' : 'professional')}
            >
              <span className="font-semibold text-sm">Specific Form Overrides (Optional)</span>
              {expandedSection === 'professional' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            {expandedSection === 'professional' && (
              <div className="p-3 space-y-3 border-t border-[#27272a] grid grid-cols-2 gap-3">
                <div className="space-y-1 col-span-1">
                  <label className="text-xs text-muted-light">First Name</label>
                  <input className="glass-input !py-1.5" value={formData.data?.firstName || ''} onChange={e => updateDataField('firstName', e.target.value)} />
                </div>
                <div className="space-y-1 col-span-1">
                  <label className="text-xs text-muted-light">Last Name</label>
                  <input className="glass-input !py-1.5" value={formData.data?.lastName || ''} onChange={e => updateDataField('lastName', e.target.value)} />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-light">Email</label>
                  <input className="glass-input !py-1.5" type="email" value={formData.data?.email || ''} onChange={e => updateDataField('email', e.target.value)} />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-light">Phone</label>
                  <input className="glass-input !py-1.5" type="tel" value={formData.data?.phone || ''} onChange={e => updateDataField('phone', e.target.value)} />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-light">Address</label>
                  <input className="glass-input !py-1.5" value={formData.data?.address || ''} onChange={e => updateDataField('address', e.target.value)} placeholder="Street name & apt" />
                </div>
                <div className="space-y-1 col-span-1">
                  <label className="text-xs text-muted-light">City</label>
                  <input className="glass-input !py-1.5" value={formData.data?.city || ''} onChange={e => updateDataField('city', e.target.value)} />
                </div>
                <div className="space-y-1 col-span-1">
                  <label className="text-xs text-muted-light">Country</label>
                  <input className="glass-input !py-1.5" value={formData.data?.country || ''} onChange={e => updateDataField('country', e.target.value)} />
                </div>
                <div className="space-y-1 col-span-2">
                  <label className="text-xs text-muted-light">Bio (Important for AI context)</label>
                  <textarea className="glass-textarea" value={formData.data?.bio || ''} onChange={e => updateDataField('bio', e.target.value)} rows={3} placeholder="A short description of yourself..." />
                </div>
              </div>
            )}
          </div>

          {/* Section: Professional */}
          <div className="glass-card-static rounded-lg overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-3 bg-[#18181b]/50"
              onClick={() => setExpandedSection(expandedSection === 'social' ? '' : 'social')}
            >
              <span className="font-semibold text-sm">Professional History</span>
              {expandedSection === 'social' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            {expandedSection === 'social' && (
              <div className="p-3 space-y-3 border-t border-[#27272a]">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-light">Company</label>
                    <input className="glass-input !py-1.5" value={formData.data?.company || ''} onChange={e => updateDataField('company', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-light">Role/Title</label>
                    <input className="glass-input !py-1.5" value={formData.data?.role || ''} onChange={e => updateDataField('role', e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-light">Skills (comma separated)</label>
                  <textarea className="glass-textarea !min-h-[40px]" value={formData.data?.skills || ''} onChange={e => updateDataField('skills', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-light">Experience Summary</label>
                  <textarea className="glass-textarea" value={formData.data?.experience || ''} onChange={e => updateDataField('experience', e.target.value)} rows={3} placeholder="Paste your resume summary here..." />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-light">Projects Highlights</label>
                  <textarea className="glass-textarea" value={formData.data?.projects || ''} onChange={e => updateDataField('projects', e.target.value)} rows={3} placeholder="Built FormPilot..." />
                </div>
              </div>
            )}
          </div>

          {/* Section: Links & Social */}
          <div className="glass-card-static rounded-lg overflow-hidden">
            <button 
              className="w-full flex items-center justify-between p-3 bg-[#18181b]/50"
              onClick={() => setExpandedSection(expandedSection === 'links' ? '' : 'links')}
            >
              <span className="font-semibold text-sm">Links & Social</span>
              {expandedSection === 'links' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            
            {expandedSection === 'links' && (
              <div className="p-3 space-y-3 border-t border-[#27272a]">
                <div className="space-y-1">
                  <label className="text-xs text-muted-light">Website</label>
                  <input className="glass-input !py-1.5" type="url" value={formData.data?.website || ''} onChange={e => updateDataField('website', e.target.value)} placeholder="https://" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-light">LinkedIn URL</label>
                  <input className="glass-input !py-1.5" type="url" value={formData.data?.linkedin || ''} onChange={e => updateDataField('linkedin', e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-light">GitHub URL</label>
                  <input className="glass-input !py-1.5" type="url" value={formData.data?.github || ''} onChange={e => updateDataField('github', e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
