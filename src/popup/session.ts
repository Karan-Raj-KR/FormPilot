/* ─────────────────────────────────────────────────
   FormPilot — Popup state that survives the popup
   Chrome tears the popup down the moment it loses focus: clicking the page,
   opening a file chooser, switching windows. Anything the user was part-way
   through has to live outside React or it is gone.

   chrome.storage.session is memory-only — never written to disk, cleared when
   the browser closes — which is what half-typed personal details should be.
   ───────────────────────────────────────────────── */
import { useEffect, useRef, useState } from 'react';

const store = () =>
  (typeof chrome !== 'undefined' && chrome.storage?.session) ? chrome.storage.session : null;

export async function readSession<T>(key: string): Promise<T | null> {
  const area = store();
  if (!area) return null;
  try {
    return ((await area.get(key))[key] as T) ?? null;
  } catch {
    return null;
  }
}

export async function writeSession<T>(key: string, value: T | null): Promise<void> {
  const area = store();
  if (!area) return;
  try {
    if (value === null || value === undefined) await area.remove(key);
    else await area.set({ [key]: value });
  } catch { /* quota or teardown — state is a convenience, not a promise */ }
}

/* Like useState, but the value is restored when the popup is reopened.
   `restored` says whether the first read has happened, so a caller can avoid
   acting on the initial value before the real one arrives. */
export function useSessionState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    let live = true;
    readSession<T>(key).then((saved) => {
      if (!live) return;
      if (saved !== null) {
        setValue(saved);
        latest.current = saved;
      }
      setRestored(true);
    });
    return () => { live = false; };
  }, [key]);

  const update = (next: T | ((prev: T) => T)) => {
    const resolved = typeof next === 'function' ? (next as (prev: T) => T)(latest.current) : next;
    latest.current = resolved;
    setValue(resolved);
    void writeSession(key, resolved);
  };

  return [value, update, restored];
}

export const SESSION_KEYS = {
  PAGE: 'formpilot_ui_page',
  PROFILE_DRAFT: 'formpilot_ui_profile_draft',
  SCAN: 'formpilot_ui_scan',
} as const;
