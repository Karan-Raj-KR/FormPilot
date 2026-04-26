import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, UserCircle, Settings2, FileText, ArrowRight, ScanLine } from 'lucide-react';
import type { Page, Settings, Profile } from '../../shared/types';
import { saveSettings } from '../../shared/storage';

interface DashboardProps {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  navigateTo: (page: Page) => void;
  profiles: Profile[];
}

const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const staggerItem = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 20 } }
};

export default function DashboardPage({ settings, setSettings, navigateTo, profiles }: DashboardProps) {
  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId) || profiles[0];

  const updateSetting = (key: keyof Settings, value: any) => {
    const nextSettings = { ...settings, [key]: value };
    setSettings(nextSettings);
    saveSettings(nextSettings);
  };

  const hasApiKey = Boolean(settings.openaiApiKey || settings.anthropicApiKey || settings.geminiApiKey);
  const hasProfileSetup = activeProfile && activeProfile.data.firstName.length > 0;

  return (
    <div className="flex flex-col h-full space-y-5 pt-1 pb-6 overflow-y-auto pr-1 animate-fade-in">

      {/* Hero Welcome */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut", type: 'spring', stiffness: 200, damping: 20 }}
        className="flex flex-col items-center justify-center text-center space-y-2 mt-4 mb-2"
      >
        <motion.img
          initial={{ rotate: -15, scale: 0.8 }}
          animate={{ rotate: -5, scale: 1 }}
          transition={{ type: 'spring', stiffness: 250, damping: 15 }}
          src="/icons/icon128.png"
          className="w-16 h-16 rounded-2xl shadow-[0_0_30px_rgba(14,165,233,0.5)] mb-2 hover:rotate-[0deg] hover:scale-110 transition-all duration-300"
          alt="FormPilot Logo"
        />
        <h2 className="text-2xl font-bold text-white tracking-tight">FormPilot</h2>
        <p className="text-xs text-muted-light max-w-[260px]">Your intelligent auto-filling assistant. Welcome to the future of browsing.</p>
      </motion.div>

      {/* Getting Started Guide */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-wide">Quick Start Guide</h3>

        <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-2">

          {/* Step 1: API Keys */}
          <motion.div variants={staggerItem}
            onClick={() => navigateTo('settings')}
            className={`glass-card-static p-3 flex items-center justify-between cursor-pointer group hover:border-secondary-500/40 transition-colors ${hasApiKey ? 'opacity-60' : 'border-primary-500/50 shadow-[0_0_15px_rgba(14,165,233,0.15)] bg-primary-500/5'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasApiKey ? 'bg-secondary-500/10 text-secondary-500' : 'bg-primary-500/10 text-primary-400'}`}>
                <Settings2 size={16} />
              </div>
              <div className="text-left">
                <p className="text-[12px] font-semibold text-white">1. Configure AI Provider</p>
                <p className="text-[10px] text-muted">{hasApiKey ? 'API Key configured' : 'Add your OpenAI/Claude key'}</p>
              </div>
            </div>
            {hasApiKey ? <span className="text-[10px] font-bold text-secondary-500">✓</span> : <ArrowRight size={14} className="text-primary-400 group-hover:translate-x-1 group-hover:text-secondary-400 transition-all" />}
          </motion.div>

          {/* Step 2: Profiles */}
          <motion.div variants={staggerItem}
            onClick={() => navigateTo('profiles')}
            className={`glass-card-static p-3 flex items-center justify-between cursor-pointer group hover:border-secondary-500/40 transition-colors ${(hasProfileSetup && hasApiKey) ? 'opacity-60' : (!hasApiKey ? 'opacity-40' : 'border-primary-500/50 shadow-[0_0_15px_rgba(14,165,233,0.15)] bg-primary-500/5')}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${hasProfileSetup ? 'bg-secondary-500/10 text-secondary-500' : 'bg-primary-500/10 text-primary-400'}`}>
                <UserCircle size={16} />
              </div>
              <div className="text-left">
                <p className="text-[12px] font-semibold text-white">2. Create a Profile</p>
                <p className="text-[10px] text-muted">{hasProfileSetup ? 'Profile ready' : 'Fill in the information to inject'}</p>
              </div>
            </div>
            {hasProfileSetup ? <span className="text-[10px] font-bold text-secondary-500">✓</span> : <ArrowRight size={14} className="text-primary-400 group-hover:translate-x-1 group-hover:text-secondary-400 transition-all" />}
          </motion.div>

          {/* Step 3: Scan */}
          <motion.div variants={staggerItem}
            onClick={() => navigateTo('home')}
            className={`glass-card p-3 flex items-center justify-between cursor-pointer group transition-all ${(hasProfileSetup && hasApiKey) ? 'border-secondary-500/50 shadow-[0_4px_20px_rgba(245,158,11,0.2)] bg-secondary-500/10 hover:border-secondary-500/80 hover:bg-secondary-500/20' : 'opacity-40'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${(hasProfileSetup && hasApiKey) ? 'bg-secondary-500/20 text-secondary-400' : 'bg-primary-500/20 text-primary-400'}`}>
                <ScanLine size={16} />
              </div>
              <div className="text-left">
                <p className={`text-[12px] font-semibold ${(hasProfileSetup && hasApiKey) ? 'text-secondary-50' : 'text-white'}`}>3. Scan & Auto-Fill</p>
                <p className={`text-[10px] ${(hasProfileSetup && hasApiKey) ? 'text-secondary-200/80' : 'text-muted'}`}>Navigate to any form and scan it</p>
              </div>
            </div>
            <ArrowRight size={14} className={`${(hasProfileSetup && hasApiKey) ? 'text-secondary-400' : 'text-primary-400'} group-hover:translate-x-1.5 group-hover:scale-110 transition-all`} />
          </motion.div>

        </motion.div>
      </div>

    </div>
  );
}
