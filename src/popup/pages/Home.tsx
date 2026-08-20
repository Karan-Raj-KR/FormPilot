import React, { useState, useEffect } from 'react';
import { Search, Zap, CheckCircle2, AlertCircle, ChevronRight, Wand2, RefreshCw, Globe } from 'lucide-react';
import type { DetectedField, Profile, Page, PageContext } from '../../shared/types';
import { CATEGORY_CONFIG } from '../../shared/constants';
import { scanActiveTab } from '../scan';

interface HomeProps {
  fields: DetectedField[];
  setFields: React.Dispatch<React.SetStateAction<DetectedField[]>>;
  navigateTo: (page: Page) => void;
  activeProfile: Profile;
  autoDetect: boolean;
  pageContext: PageContext | null;
  setPageContext: (context: PageContext | null) => void;
}

export default function Home({ fields, setFields, navigateTo, activeProfile, autoDetect, pageContext, setPageContext }: HomeProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scanPage = async () => {
    setIsScanning(true);
    setError(null);
    setFields([]);

    try {
      const { fields: found, context } = await scanActiveTab();
      setFields(found);
      setPageContext(context);
      if (found.length === 0) setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to scan page');
    } finally {
      setIsScanning(false);
    }
  };

  // Initial scan if empty
  useEffect(() => {
    if (autoDetect && fields.length === 0 && !error) {
      scanPage();
    }
  }, []);

  const filledFields = fields.filter((f) => f.status === 'filled').length;
  const requiredFields = fields.filter((f) => f.required).length;
  const frameCount = new Set(fields.map((f) => f.frameId ?? 0)).size;

  // Biggest groups first — the user reads the top of the list, so put the
  // categories that actually dominate the form there.
  const categories = Object.entries(
    fields.reduce<Record<string, number>>((acc, f) => {
      acc[f.category] = (acc[f.category] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Status hero */}
      <section className="glass-card p-5 relative overflow-hidden shrink-0">
        <div className="absolute -top-12 -right-12 w-36 h-36 bg-primary-500/15 rounded-full blur-3xl" />

        <div className="relative z-10 flex flex-col items-center text-center">
          {isScanning ? (
            <>
              <div className="relative w-14 h-14 mb-3">
                <div className="absolute inset-0 rounded-full border-2 border-primary-500/30 animate-ping" />
                <div className="absolute inset-0 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-primary-400">
                  <Search size={22} />
                </div>
              </div>
              <h2 className="text-base font-bold mb-1">Reading the page</h2>
              <p className="text-xs text-muted-light">Main document, iframes and shadow DOM</p>
            </>
          ) : error ? (
            <>
              <div className="w-14 h-14 bg-red-500/15 rounded-2xl flex items-center justify-center text-red-400 mb-3">
                <AlertCircle size={26} />
              </div>
              <h2 className="text-base font-bold mb-1">Scan failed</h2>
              <p className="text-xs text-red-300/90 mb-4 px-2 leading-relaxed">{error}</p>
              <button className="btn-secondary w-full" onClick={scanPage}>Try again</button>
            </>
          ) : fields.length > 0 ? (
            <>
              <div className="w-14 h-14 bg-gradient-to-br from-primary-500 to-primary-700 rounded-2xl flex items-center justify-center text-white mb-3 shadow-[0_0_24px_rgba(14,165,233,0.35)]">
                <Zap size={26} fill="currentColor" />
              </div>
              <h2 className="text-3xl font-black tracking-tight leading-none">{fields.length}</h2>
              <p className="text-sm font-medium text-muted-light mt-1">fillable fields found</p>
              <div className="flex flex-wrap gap-1.5 justify-center mt-3">
                {requiredFields > 0 && <span className="badge badge-amber">{requiredFields} required</span>}
                {frameCount > 1 && <span className="badge badge-accent">{frameCount} frames</span>}
                {filledFields > 0 && <span className="badge badge-green">{filledFields} filled</span>}
              </div>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center text-muted mb-3">
                <CheckCircle2 size={26} />
              </div>
              <h2 className="text-base font-bold mb-1">No form here</h2>
              <p className="text-xs text-muted-light mb-4 leading-relaxed">Nothing fillable on this page. Open a form and scan again.</p>
              <button className="btn-secondary w-full" onClick={scanPage}>
                <RefreshCw size={14} /> Rescan page
              </button>
            </>
          )}
        </div>
      </section>

      {/* What the extension understands about this page */}
      {!isScanning && pageContext && fields.length > 0 && (
        <section className="glass-card-static px-3 py-2.5 flex items-start gap-2.5 shrink-0">
          <Globe size={14} className="text-primary-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{pageContext.title || pageContext.domain}</p>
            <p className="text-[11px] text-muted truncate">{pageContext.domain}</p>
          </div>
        </section>
      )}

      {!isScanning && fields.length > 0 && (
        <div className="flex-1 flex flex-col justify-between min-h-0">
          <div className="space-y-2 overflow-y-auto min-h-0 pr-1">
            <div className="flex items-center justify-between px-0.5">
              <h3 className="text-xs font-semibold text-muted-light uppercase tracking-wider">What's on this form</h3>
              <button className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={scanPage}>
                <RefreshCw size={11} /> Rescan
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {categories.map(([cat, count], idx) => {
                const config = CATEGORY_CONFIG[cat as keyof typeof CATEGORY_CONFIG] ?? CATEGORY_CONFIG.other;
                return (
                  <div key={cat} className={`glass-card-static px-2.5 py-2 flex items-center gap-2.5 stagger-${Math.min(idx + 1, 5)} animate-slide-up`}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-sm" style={{ backgroundColor: `${config.color}1f`, color: config.color }}>
                      {config.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{config.label}</p>
                      <p className="text-[11px] text-muted">{count} field{count === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-4 shrink-0">
            <button className="btn-primary w-full py-3.5 text-sm" onClick={() => navigateTo('preview')}>
              <Wand2 size={17} />
              <span>Review &amp; auto-fill</span>
              <ChevronRight size={16} className="ml-auto opacity-70" />
            </button>
            <p className="text-center text-[11px] text-muted mt-2">
              Using <span className="text-primary-400 font-medium">{activeProfile?.emoji} {activeProfile?.name}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
