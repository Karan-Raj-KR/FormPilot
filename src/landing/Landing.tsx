import React, { useEffect } from 'react';
import { Sparkles, ArrowRight, Zap, UserCircle } from 'lucide-react';
import { getSettings } from '../shared/storage';
import type { Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/constants';

export default function Landing() {
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = React.useState(false);

  useEffect(() => {
    getSettings().then(s => {
      setSettings(s);
      setIsLoaded(true);
    });
  }, []);

  if (!isLoaded) return null;

  return (
    <div className="min-h-screen bg-[#09090b] text-white overflow-x-hidden relative flex flex-col items-center">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-primary-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] bg-primary-400/10 rounded-full blur-[140px] pointer-events-none"></div>

      {/* Navbar */}
      <nav className="w-full max-w-6xl p-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-3">
          <img src="/icons/icon48.png" className="w-10 h-10 rounded-xl shadow-[0_0_20px_rgba(14,165,233,0.4)]" alt="FormPilot Logo" />
          <span className="font-bold text-xl tracking-wide">Form<span className="text-primary-400">Pilot</span></span>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl px-6 grid grid-cols-1 md:grid-cols-2 items-center gap-12 lg:gap-16 relative z-10 py-12 mx-auto">
        
        {/* Left: Copy & CTA */}
        <div className="space-y-8 max-w-2xl text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-500/10 border border-primary-500/30 text-primary-400 text-xs font-semibold mb-2 shadow-[0_0_15px_rgba(14,165,233,0.15)] animate-fade-in">
            <Sparkles size={14} /> Extension successfully installed
          </div>
          
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.1]">
            Forms are boring.<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-300 via-primary-500 to-primary-600">Let AI do the work.</span>
          </h1>
          
          <p className="text-lg md:text-xl text-muted-light max-w-xl mx-auto md:mx-0 leading-relaxed">
            FormPilot understands context, remembers your profile data, and magically completes applications in a single click using Claude or ChatGPT.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row items-center gap-4 justify-center md:justify-start">
            <a 
              href="https://chrome.google.com/webstore" 
              target="_blank" 
              rel="noreferrer"
              className="btn-primary py-4 px-8 text-base shadow-[0_10px_40px_rgba(14,165,233,0.4)] hover:shadow-[0_10px_60px_rgba(14,165,233,0.6)] w-full sm:w-auto"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13.84 5.25L17.11 10.93C15.82 10.37 14.41 10 13 10H8.38L10.3 6.67C10.84 6.42 11.41 6.25 12 6.25C12.65 6.25 13.27 6.43 13.84 5.25ZM5.41 8.5L8.53 13.88L6.47 17.47C4.65 16.27 3.32 14.28 3.06 12C3.06 10.66 3.42 9.42 4.02 8.35L5.41 8.5ZM12 21.04C10.15 21.04 8.46 20.37 7.15 19.3L10.42 13.62C10.97 14.63 12 15.35 13.15 15.65L12 21.04ZM18.73 17.57C17.29 19.3 15.11 20.5 12.65 20.89L15.62 15.75L18.73 17.57ZM15.42 13.21L12.59 18.1H18.91C19.16 17.06 19.26 15.95 19.16 14.85C18.91 13.75 18.29 13.31 15.42 13.21Z"/></svg>
              Add to Chrome
            </a>
            
            <a href="/privacy.html" target="_blank" rel="noreferrer" className="flex items-center gap-2 text-muted hover:text-white transition-colors py-2 px-4 group text-sm font-medium whitespace-nowrap">
              View Privacy Policy
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
          
        </div>

        {/* Right: Feature Cards */}
        <div className="flex-1 w-full max-w-md relative animate-slide-up stagger-2">
          <div className="glass-card p-6 space-y-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary-500/20 rounded-full blur-[50px]"></div>
            
            <h3 className="text-xl font-bold tracking-tight">How it works</h3>
            
            <div className="space-y-4">
              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 rounded-full bg-[#27272a] border border-[#3f3f46] flex items-center justify-center shrink-0">
                  <UserCircle size={20} className="text-muted-light" />
                </div>
                <div>
                  <h4 className="font-semibold text-white">1. Open the Extension</h4>
                  <p className="text-sm text-muted mt-1 leading-relaxed">Click the FormPilot icon in your extensions toolbar and add your OpenAI/Claude key.</p>
                </div>
              </div>

              <div className="flex gap-4 items-start relative">
                <div className="w-10 h-10 rounded-full bg-primary-500/20 border border-primary-500/40 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(14,165,233,0.3)]">
                  <Zap size={20} className="text-primary-400" />
                </div>
                <div>
                  <h4 className="font-semibold text-white">2. Scan & Inject</h4>
                  <p className="text-sm text-muted mt-1 leading-relaxed">Let AI read the webpage, parse inputs intelligently, and fill jobs/forms instantly.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full p-6 text-center text-xs font-medium text-muted-dark z-10">
        &copy; {new Date().getFullYear()} FormPilot. All intelligence reserved.
      </footer>
    </div>
  );
}
