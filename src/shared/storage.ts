import type { Profile, Settings, FillHistoryEntry, PaymentCard, PasswordEntry } from './types';
import {
  DEFAULT_PROFILES, DEFAULT_SETTINGS, STORAGE_KEYS, PROVIDERS, RETIRED_MODEL_IDS,
} from './constants.ts';

// ─── Chrome storage detection ───
const isChromeStorage =
  typeof chrome !== 'undefined' &&
  typeof chrome.storage !== 'undefined' &&
  typeof chrome.storage.local !== 'undefined';

// ─── Generic get/set with fallback to localStorage ───
export async function getItem<T>(key: string): Promise<T | null> {
  if (isChromeStorage) {
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (result) => {
        resolve(result[key] ?? null);
      });
    });
  }
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  if (isChromeStorage) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export async function removeItem(key: string): Promise<void> {
  if (isChromeStorage) {
    return new Promise((resolve) => chrome.storage.local.remove(key, () => resolve()));
  }
  localStorage.removeItem(key);
}

// ─── Profiles ───
export async function getProfiles(): Promise<Profile[]> {
  const profiles = await getItem<Profile[]>(STORAGE_KEYS.PROFILES);
  return profiles ?? DEFAULT_PROFILES;
}

export async function saveProfiles(profiles: Profile[]): Promise<void> {
  await setItem(STORAGE_KEYS.PROFILES, profiles);
}

export async function addProfile(profile: Profile): Promise<Profile[]> {
  const profiles = await getProfiles();
  profiles.push(profile);
  await saveProfiles(profiles);
  return profiles;
}

export async function updateProfile(updated: Profile): Promise<Profile[]> {
  const profiles = await getProfiles();
  const index = profiles.findIndex((p) => p.id === updated.id);
  if (index !== -1) {
    profiles[index] = { ...updated, updatedAt: Date.now() };
    await saveProfiles(profiles);
  }
  return profiles;
}

export async function deleteProfile(profileId: string): Promise<Profile[]> {
  let profiles = await getProfiles();
  profiles = profiles.filter((p) => p.id !== profileId);
  await saveProfiles(profiles);
  return profiles;
}

// ─── Settings ───
// v1 stored one hardcoded field per provider (openaiApiKey, groqModel, …).
// v2 keys them by provider id so a new provider is a table entry, not a schema
// change. Existing installs are migrated on read.
function migrateSettings(saved: any): Settings {
  const merged: any = { ...DEFAULT_SETTINGS, ...saved };
  merged.providers = { ...(saved?.providers ?? {}) };

  for (const id of Object.keys(PROVIDERS)) {
    const legacyKey = saved?.[`${id}ApiKey`];
    const legacyModel = saved?.[`${id}Model`];
    if (legacyKey || legacyModel) {
      merged.providers[id] = {
        apiKey: merged.providers[id]?.apiKey || legacyKey || '',
        model: merged.providers[id]?.model || legacyModel || '',
        baseUrl: merged.providers[id]?.baseUrl,
      };
    }
    delete merged[`${id}ApiKey`];
    delete merged[`${id}Model`];
  }

  // Retired model ids (claude-3-7-sonnet, mixtral-8x7b, …) 404 at the provider.
  // Only clear ids we know are stale — a free-typed OpenRouter/NIM id is valid
  // even though it is not in our suggestion list.
  for (const [id, cfg] of Object.entries(merged.providers as Record<string, any>)) {
    if (RETIRED_MODEL_IDS.includes(cfg?.model)) cfg.model = PROVIDERS[id]?.models[0] ?? '';
  }
  if (!PROVIDERS[merged.aiProvider]) merged.aiProvider = DEFAULT_SETTINGS.aiProvider;
  return merged as Settings;
}

export async function getSettings(): Promise<Settings> {
  const settings = await getItem<any>(STORAGE_KEYS.SETTINGS);
  return settings ? migrateSettings(settings) : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await setItem(STORAGE_KEYS.SETTINGS, settings);
}

// ─── Fill History ───
export async function getHistory(): Promise<FillHistoryEntry[]> {
  const history = await getItem<FillHistoryEntry[]>(STORAGE_KEYS.HISTORY);
  return history ?? [];
}

export async function addHistoryEntry(entry: FillHistoryEntry): Promise<void> {
  const history = await getHistory();
  history.unshift(entry); // newest first
  // Keep only last 100 entries
  if (history.length > 100) history.length = 100;
  await setItem(STORAGE_KEYS.HISTORY, history);
}

export async function saveHistory(history: FillHistoryEntry[]): Promise<void> {
  await setItem(STORAGE_KEYS.HISTORY, history);
}

export async function clearHistory(): Promise<void> {
  await setItem(STORAGE_KEYS.HISTORY, []);
}

// ─── Generate unique ID ───
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ─── Payment Cards ───
// Stored as plaintext in chrome.storage.local, which is sandboxed to this
// extension. When sync is enabled these are encrypted before upload (crypto.ts)
// — the server never sees them in the clear.
export async function getPaymentCards(): Promise<PaymentCard[]> {
  const cards = await getItem<PaymentCard[]>(STORAGE_KEYS.PAYMENT_CARDS);
  return cards ?? [];
}

export async function savePaymentCards(cards: PaymentCard[]): Promise<void> {
  await setItem(STORAGE_KEYS.PAYMENT_CARDS, cards);
}

export async function addPaymentCard(card: PaymentCard): Promise<void> {
  const cards = await getPaymentCards();
  cards.push(card);
  await savePaymentCards(cards);
}

export async function deletePaymentCard(id: string): Promise<void> {
  const cards = await getPaymentCards();
  await savePaymentCards(cards.filter((c) => c.id !== id));
}

// ─── Passwords ───
// Same storage model as payment cards above: local plaintext, encrypted in
// transit and at rest on the server when sync is on.
export async function getPasswords(): Promise<PasswordEntry[]> {
  const entries = await getItem<PasswordEntry[]>(STORAGE_KEYS.PASSWORDS);
  return entries ?? [];
}

export async function savePasswords(entries: PasswordEntry[]): Promise<void> {
  await setItem(STORAGE_KEYS.PASSWORDS, entries);
}

export async function addPassword(entry: PasswordEntry): Promise<void> {
  const entries = await getPasswords();
  entries.push(entry);
  await savePasswords(entries);
}

export async function deletePassword(id: string): Promise<void> {
  const entries = await getPasswords();
  await savePasswords(entries.filter((e) => e.id !== id));
}

export async function updatePassword(id: string, updates: Partial<PasswordEntry>): Promise<void> {
  const entries = await getPasswords();
  const index = entries.findIndex((e) => e.id === id);
  if (index !== -1) {
    entries[index] = { ...entries[index], ...updates, updatedAt: Date.now() };
    await savePasswords(entries);
  }
}

export async function getPasswordsForDomain(domain: string): Promise<PasswordEntry[]> {
  const entries = await getPasswords();
  return entries.filter((e) => e.domain === domain);
}
