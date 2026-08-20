import React, { useState, useEffect } from 'react';
import { Search, Zap, CheckCircle2, AlertCircle, ChevronRight, Wand2 } from 'lucide-react';
import type { DetectedField, Profile, Page } from '../../shared/types';
import { CATEGORY_CONFIG } from '../../shared/constants';

interface HomeProps {
  fields: DetectedField[];
  setFields: React.Dispatch<React.SetStateAction<DetectedField[]>>;
  navigateTo: (page: Page) => void;
  activeProfile: Profile;
  autoDetect: boolean;
}

export default function Home({ fields, setFields, navigateTo, activeProfile, autoDetect }: HomeProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanPage = async () => {
    setIsScanning(true);
    setError(null);
    setFields([]);

    try {
      if (!chrome?.tabs) throw new Error('Not running in extension environment');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) throw new Error('No active tab found');
      if (tab.url?.startsWith('chrome://')) throw new Error('Cannot run on internal Chrome pages');

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_FIELDS' }).catch(async (err) => {
        // Fallback if content script isn't injected yet (e.g. the page was open
        // before the extension was installed or reloaded).
        if (!String(err?.message).includes('Receiving end does not exist')) throw err;
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          files: ['content.js'],
        });
        return chrome.tabs.sendMessage(tab.id!, { type: 'SCAN_FIELDS' });
      });

      if (response?.fields) {
        setFields(response.fields);
      } else {
        throw new Error('Invalid response from content script');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to scan page');
    } finally {
      // Fake delay for dramatic UI effect
      setTimeout(() => setIsScanning(false), 800);
    }
  };

  // Initial scan if empty
  useEffect(() => {
    if (autoDetect && fields.length === 0 && !error) {
      scanPage();
    }
  }, []);

  const pendingFields = fields.filter(f => f.status === 'pending').length;
  const filledFields = fields.filter(f => f.status === 'filled').length;

  const categories = Array.from(new Set(fields.map(f => f.category)));

  return (
    <div className="flex flex-col h-full">
      {/* Status Hero */}
      <div className="glass-card p-5 pb-6 mb-4 relative overflow-hidden group shrink-0">
        {/* Animated background glow */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-primary-500/20 rounded-full blur-2xl group-hover:bg-primary-500/30 transition-colors duration-500"></div>
        
        <div className="relative z-10 flex flex-col items-center text-center">
          {isScanning ? (
            <>
              <div className="relative w-16 h-16 mb-3">
                <div className="absolute inset-0 rounded-full border-2 border-primary-500/30 animate-ping"></div>
                <div className="absolute inset-0 rounded-full border-2 border-primary-500 border-t-transparent animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center text-primary-400">
                  <Search size={24} />
                </div>
              </div>
              <h2 className="text-lg font-bold text-white mb-1">Scanning DOM...</h2>
              <p className="text-xs text-muted-light">Analyzing form structure and fields</p>
            </>
          ) : error ? (
            <>
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 mb-3 mx-auto">
                <AlertCircle size={28} />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">Scan Failed</h2>
              <p className="text-xs text-red-400 mb-4 px-4">{error}</p>
              <button className="btn-secondary w-full" onClick={scanPage}>Try Again</button>
            </>
          ) : fields.length > 0 ? (
            <>
              <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center text-white mb-3 mx-auto shadow-[0_0_20px_rgba(139,92,246,0.4)]">
                <Zap size={28} fill="currentColor" className="text-white/90" />
              </div>
              <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary-200 to-white mb-1 tracking-tight">
                {fields.length} Fields Found
              </h2>
              <div className="flex gap-2 justify-center mt-2">
                <div className="badge badge-accent">{pendingFields} pending</div>
                {filledFields > 0 && <div className="badge badge-green">{filledFields} filled</div>}
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 bg-[#27272a] rounded-full flex items-center justify-center text-muted mb-3 mx-auto">
                <CheckCircle2 size={28} />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">No Forms Found</h2>
              <p className="text-xs text-muted-light mb-4">We couldn't detect any input fields here.</p>
              <button className="btn-secondary w-full" onClick={scanPage}>Rescan Page</button>
            </>
          )}
        </div>
      </div>

      {/* Main Action Block - only show if fields exist and not scanning */}
      {!isScanning && fields.length > 0 && (
        <div className="flex-1 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-muted-light uppercase tracking-wider px-1">Detected Contexts</h3>
            
            <div className="grid grid-cols-2 gap-2">
              {categories.slice(0, 4).map((cat, idx) => {
                const config = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.other;
                const count = fields.filter(f => f.category === cat).length;
                return (
                  <div key={cat} className={`glass-card-static p-2 flex items-center gap-2 stagger-${idx + 1} animate-slide-up`}>
                    <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${config.color}20`, color: config.color }}>
                      <span className="text-xs">{config.icon}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{config.label}</p>
                      <p className="text-[10px] text-muted">{count} fields</p>
                    </div>
                  </div>
                );
              })}
            </div>
            
            {categories.length > 4 && (
              <p className="text-xs text-center text-muted italic">...and {categories.length - 4} more contexts</p>
            )}
          </div>

          <div className="mt-4 animate-slide-up stagger-4">
            <button 
              className="btn-primary w-full py-4 text-[15px]" 
              onClick={() => navigateTo('preview')}
            >
              <Wand2 size={18} />
              <span>Review & Auto-fill</span>
              <ChevronRight size={16} className="ml-auto opacity-70" />
            </button>
            <p className="text-center text-[10px] text-muted mt-2">
              Using profile: <span className="text-primary-400 font-medium">{activeProfile.name}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
