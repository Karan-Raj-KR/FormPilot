import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Clock, UserCircle2, LayoutDashboard, ScanLine, LockKeyhole, Cloud, Brain } from 'lucide-react';
import type { Page, Profile, Settings, DetectedField, PageContext } from '../shared/types';
import { getProfiles, getSettings } from '../shared/storage';
import { useSessionState, SESSION_KEYS } from './session';
import { DEFAULT_SETTINGS } from '../shared/constants';
import { clearHighlights } from './scan';

import DashboardPage from './pages/Dashboard';
import HomePage from './pages/Home';
import PreviewPage from './pages/Preview';
import ProfilesPage from './pages/Profiles';
import SettingsPage from './pages/Settings';
import HistoryPage from './pages/History';
import PaymentVaultPage from './pages/PaymentVault';
import PasswordVaultPage from './pages/PasswordVault';
import AccountPage from './pages/Account';
import MemoryPage from './pages/Memory';

export default function App() {
  // Which tab the user was on survives the popup being torn down: Chrome
  // destroys it on every focus loss, and landing back on Home each time makes
  // the extension feel like it forgot what you were doing.
  const [currentPage, setCurrentPage, pageRestored] = useSessionState<Page>(SESSION_KEYS.PAGE, 'home');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  /* A scan costs a round trip and a fill costs an API call, so neither should
     be thrown away just because the popup lost focus. Kept against the URL it
     came from: restoring one page's fields onto another would point every
     selector at the wrong document. */
  const [scan, setScan, scanRestored] = useSessionState<{ url: string; fields: DetectedField[]; context: PageContext | null }>(
    SESSION_KEYS.SCAN, { url: '', fields: [], context: null },
  );
  const [isLoading, setIsLoading] = useState(true);

  // Tab state
  const [activeTabUrl, setActiveTabUrl] = useState<string>('');

  const samePage = Boolean(activeTabUrl) && scan.url === activeTabUrl;
  const fields = samePage ? scan.fields : [];
  const pageContext = samePage ? scan.context : null;
  const setFields = (next: DetectedField[] | ((prev: DetectedField[]) => DetectedField[])) =>
    setScan((prev) => ({
      url: activeTabUrl,
      context: prev.url === activeTabUrl ? prev.context : null,
      fields: typeof next === 'function' ? next(prev.url === activeTabUrl ? prev.fields : []) : next,
    }));
  const setPageContext = (context: PageContext | null) =>
    setScan((prev) => ({ ...prev, url: activeTabUrl, context }));

  useEffect(() => {
    Promise.all([getProfiles(), getSettings()]).then(([p, s]) => {
      setProfiles(p);
      setSettings(s);
      setIsLoading(false);
    });

    let tabId: number | undefined;
    if (chrome?.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        tabId = tabs[0]?.id;
        setActiveTabUrl(tabs[0]?.url || '');
      });
    }

    // Leave no highlight behind when the popup closes.
    return () => { if (tabId !== undefined) clearHighlights(tabId); };
  }, []);

  const activeProfile = profiles.find((p) => p.id === settings.activeProfileId) || profiles[0];

  // Waiting for the restore avoids a flash of the Home tab, and stops Home's
  // auto-scan from firing over results that are about to come back.
  if (isLoading || !pageRestored || !scanRestored) {
    return (
      <div className="flex items-center justify-center h-full bg-[#09090b]">
        <div className="w-8 h-8 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  const navigateTo = (page: Page) => setCurrentPage(page);

  const PageComponent = {
    dashboard: <DashboardPage settings={settings} setSettings={setSettings} navigateTo={navigateTo} profiles={profiles} fieldCount={fields.length} />,
    home: <HomePage fields={fields} setFields={setFields} navigateTo={navigateTo} activeProfile={activeProfile} autoDetect={settings.autoDetect} pageContext={pageContext} setPageContext={setPageContext} />,
    preview: <PreviewPage fields={fields} setFields={setFields} navigateTo={navigateTo} activeProfile={activeProfile} activeTabUrl={activeTabUrl} pageContext={pageContext} />,
    profiles: <ProfilesPage profiles={profiles} setProfiles={setProfiles} activeProfileId={settings.activeProfileId} setSettings={setSettings} />,
    settings: <SettingsPage settings={settings} setSettings={setSettings} profiles={profiles} />,
    history: <HistoryPage />,
    paymentVault: <PaymentVaultPage navigateTo={navigateTo} />,
    passwordVault: <PasswordVaultPage navigateTo={navigateTo} />,
    account: <AccountPage />,
    memory: <MemoryPage />,
  }[currentPage];

  return (
    <div className="flex flex-col h-full bg-[#09090b] text-white">
      <header className="px-4 py-2.5 border-b border-[#27272a] flex items-center justify-between bg-black/20 backdrop-blur-md shrink-0">
        <button className="flex items-center gap-2" onClick={() => navigateTo('dashboard')}>
          <img src="/icons/icon48.png" className="w-6 h-6 rounded" alt="" />
          <span className="font-semibold text-sm tracking-tight">Form<span className="text-primary-400">Pilot</span></span>
        </button>

        {currentPage !== 'dashboard' && activeProfile && (
          <button
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#27272a] rounded-full border border-[#3f3f46] text-xs hover:border-primary-500/50 transition-colors"
            onClick={() => navigateTo('profiles')}
            title="Switch profile"
          >
            <span>{activeProfile.emoji}</span>
            <span className="font-medium truncate max-w-[90px]">{activeProfile.name}</span>
          </button>
        )}
      </header>

      <main className="flex-1 overflow-hidden relative min-h-0">
        <div className="absolute inset-0 p-4 overflow-hidden">
          <div className="page-active h-full">{PageComponent}</div>
        </div>
      </main>

      <nav className="flex items-stretch px-1 py-2 border-t border-[#27272a] bg-[#18181b]/90 backdrop-blur-md shrink-0">
        <NavItem active={currentPage === 'dashboard'} icon={<LayoutDashboard size={17} />} label="Home" onClick={() => navigateTo('dashboard')} />
        <NavItem active={currentPage === 'home' || currentPage === 'preview'} icon={<ScanLine size={17} />} label="Scan" onClick={() => navigateTo('home')} />
        <NavItem active={currentPage === 'profiles'} icon={<UserCircle2 size={17} />} label="You" onClick={() => navigateTo('profiles')} />
        <NavItem active={currentPage === 'memory'} icon={<Brain size={17} />} label="Memory" onClick={() => navigateTo('memory')} />
        <NavItem active={currentPage === 'paymentVault' || currentPage === 'passwordVault'} icon={<LockKeyhole size={17} />} label="Vault" onClick={() => navigateTo('paymentVault')} />
        <NavItem active={currentPage === 'history'} icon={<Clock size={17} />} label="History" onClick={() => navigateTo('history')} />
        <NavItem active={currentPage === 'account'} icon={<Cloud size={17} />} label="Sync" onClick={() => navigateTo('account')} />
        <NavItem active={currentPage === 'settings'} icon={<SettingsIcon size={17} />} label="Setup" onClick={() => navigateTo('settings')} />
      </nav>
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 rounded-lg transition-colors ${
        active ? 'text-primary-400 bg-primary-500/10' : 'text-muted-dark hover:text-muted-light'
      }`}
      onClick={onClick}
      title={label}
    >
      {icon}
      <span className="text-[9.5px] font-medium leading-none">{label}</span>
    </button>
  );
}
