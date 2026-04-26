import React, { useState, useEffect } from 'react';
import { History as HistoryIcon, Search, ExternalLink, Calendar, MapPin, Trash2, ArrowRight } from 'lucide-react';
import type { FillHistoryEntry } from '../../shared/types';
import { getHistory, clearHistory } from '../../shared/storage';

export default function HistoryPage() {
  const [history, setHistory] = useState<FillHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<FillHistoryEntry | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const data = await getHistory();
    setHistory(data);
    setIsLoading(false);
  };

  const handleClear = async () => {
    if (confirm('Clear all fill history? This cannot be undone.')) {
      await clearHistory();
      setHistory([]);
      setSelectedEntry(null);
    }
  };

  if (isLoading) return <div className="p-4"><div className="shimmer h-12 w-full rounded-xl"></div></div>;

  if (selectedEntry) {
    return (
      <div className="flex flex-col h-full -mx-4 -my-4 h-[calc(100%+2rem)] bg-[#09090b]">
        <div className="flex items-center justify-between p-4 border-b border-[#27272a] sticky top-0 bg-[#09090b]/95 backdrop-blur-md z-20">
          <button className="btn-ghost !p-2 -ml-2" onClick={() => setSelectedEntry(null)}>
            <ArrowRight size={18} className="rotate-180" />
          </button>
          <span className="font-semibold text-sm truncate max-w-[200px]">{selectedEntry.domain}</span>
          <div className="w-8"></div> {/* spacer */}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="glass-card-static p-4 border-l-4 border-l-primary-500">
            <h3 className="font-bold text-lg leading-tight mb-1">{selectedEntry.title}</h3>
            <a href={selectedEntry.url} target="_blank" rel="noreferrer" className="text-[10px] text-primary-400 flex items-center gap-1 hover:underline mb-3">
              {selectedEntry.url} <ExternalLink size={10} />
            </a>
            
            <div className="flex flex-wrap gap-2 text-[10px] text-muted-light mt-2 border-t border-[#27272a] pt-3">
              <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(selectedEntry.timestamp).toLocaleString()}</span>
              <span className="flex items-center gap-1"><MapPin size={12} /> Profile: {selectedEntry.profileName}</span>
              <span className="badge badge-accent">{selectedEntry.filledCount} items filled</span>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-muted-dark uppercase tracking-wider pl-1">Filled Values</h4>
            <div className="glass-card-static rounded-lg overflow-hidden border-[#27272a] divide-y divide-[#27272a]">
              {selectedEntry.fields.map((f, i) => (
                <div key={i} className="p-3">
                  <p className="text-[10px] font-semibold text-muted-dark uppercase mb-1">{f.label || 'Unknown Field'}</p>
                  <p className="text-sm font-medium text-white break-words">{f.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-4 pt-1">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xl font-bold text-white tracking-tight">History</h2>
        {history.length > 0 && (
          <button className="btn-ghost text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={handleClear}>
            <Trash2 size={14} /> <span className="text-[10px] uppercase font-bold">Clear</span>
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 bg-[#18181b]/30 rounded-2xl border border-dashed border-[#27272a]">
          <div className="w-12 h-12 bg-[#27272a] rounded-full flex items-center justify-center text-muted mb-3">
            <HistoryIcon size={20} />
          </div>
          <h3 className="font-semibold mb-1">No history yet</h3>
          <p className="text-xs text-muted-light">Forms you fill with FormPilot will appear here for easy reuse.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 space-y-3 pb-4">
          {history.map((entry, idx) => (
            <div 
              key={entry.id} 
              className={`glass-card p-3 cursor-pointer group stagger-${Math.min(idx + 1, 5)} animate-slide-up`}
              onClick={() => setSelectedEntry(entry)}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded bg-[#27272a] flex items-center justify-center shrink-0">
                    <img src={`https://www.google.com/s2/favicons?domain=${entry.domain}&sz=32`} alt="" className="w-4 h-4" onError={(e) => {
                      (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjOWI5NWE4IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiPjwvY2lyY2xlPjwvc3ZnPg==';
                    }} />
                  </div>
                  <h3 className="font-semibold text-sm truncate max-w-[200px] text-white group-hover:text-primary-400 transition-colors">
                    {entry.domain}
                  </h3>
                </div>
                <span className="text-[10px] text-muted whitespace-nowrap">
                  {new Date(entry.timestamp).toLocaleDateString()}
                </span>
              </div>
              
              <p className="text-xs text-muted-light truncate mb-2">{entry.title}</p>
              
              <div className="flex items-center justify-between border-t border-[#27272a] pt-2 mt-1">
                <span className="text-[10px] text-muted flex items-center gap-1">
                  <MapPin size={10} /> {entry.profileName}
                </span>
                <span className="badge badge-accent !text-[9px]">{entry.filledCount} fields</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
