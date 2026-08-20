/* ─────────────────────────────────────────────────
   FormPilot — Profile rules
   Validation, completeness and the secret scan, kept out of the React
   component so they can be tested directly.
   ───────────────────────────────────────────────── */
import type { Profile, ProfileData } from './types.ts';
import { SECRET_IN_TEXT, EMPTY_PROFILE_DATA } from './constants.ts';

// A profile is a prompt, and prompts cost money and context. These caps keep a
// pasted résumé from turning every fill into a 40k-token request.
export const LIMITS = {
  name: 40,
  systemPrompt: 2000,
  rawInfo: 20000,
  field: 2000,
  customFields: 30,
  customKey: 60,
} as const;

export interface FieldIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL_LIKE = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/;
const PHONE = /^[+\d][\d\s()\-.]{5,}$/;

/* Blocking problems only. Anything the user might legitimately mean is a
   warning, never an error — this is their data, not a form we get to reject. */
export function validateProfile(profile: Partial<Profile>): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const data = (profile.data ?? {}) as ProfileData;

  const name = (profile.name ?? '').trim();
  if (!name) issues.push({ field: 'name', message: 'Give this profile a name.', severity: 'error' });
  else if (name.length > LIMITS.name) issues.push({ field: 'name', message: `Keep the name under ${LIMITS.name} characters.`, severity: 'error' });

  if (data.email && !EMAIL.test(data.email.trim())) {
    issues.push({ field: 'email', message: 'That does not look like an email address.', severity: 'error' });
  }
  if (data.phone && !PHONE.test(data.phone.trim())) {
    issues.push({ field: 'phone', message: 'That does not look like a phone number.', severity: 'warning' });
  }
  for (const key of ['website', 'linkedin', 'github', 'twitter'] as const) {
    const value = data[key]?.trim();
    if (value && !URL_LIKE.test(value)) {
      issues.push({ field: key, message: 'Expected a link, e.g. linkedin.com/in/you', severity: 'warning' });
    }
  }
  if ((profile.systemPrompt ?? '').length > LIMITS.systemPrompt) {
    issues.push({ field: 'systemPrompt', message: `Instructions are capped at ${LIMITS.systemPrompt} characters.`, severity: 'error' });
  }
  if ((data.rawInfo ?? '').length > LIMITS.rawInfo) {
    issues.push({ field: 'rawInfo', message: `Over ${LIMITS.rawInfo.toLocaleString()} characters — trim it, or every fill gets slow and expensive.`, severity: 'error' });
  }

  const customCount = Object.keys(data.customFields ?? {}).length;
  if (customCount > LIMITS.customFields) {
    issues.push({ field: 'customFields', message: `Keep it to ${LIMITS.customFields} custom fields.`, severity: 'error' });
  }
  return issues;
}

/* Everything in a profile is sent to whichever AI provider the user picked.
   If they have pasted a passport number into their bio, they should be told
   before it leaves the machine — not silently stopped, told. */
export function findSecrets(profile: Partial<Profile>): string[] {
  const data = (profile.data ?? {}) as ProfileData;
  const found = new Set<string>();

  const scan = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    if (SECRET_IN_TEXT.test(value)) found.add(label);
  };

  for (const [key, value] of Object.entries(data)) {
    if (key === 'customFields') continue;
    scan(key, value);
  }
  for (const [key, value] of Object.entries(data.customFields ?? {})) scan(key, value);
  scan('systemPrompt', profile.systemPrompt);

  return [...found];
}

// Which fields actually carry weight when the model answers a form.
const SCORED: (keyof ProfileData)[] = [
  'firstName', 'lastName', 'email', 'phone', 'city', 'country',
  'bio', 'company', 'role', 'skills', 'experience', 'rawInfo',
];

export function profileCompleteness(profile: Partial<Profile>): number {
  const data = (profile.data ?? {}) as ProfileData;
  const filled = SCORED.filter((key) => (data[key] as string)?.trim()).length;
  return Math.round((filled / SCORED.length) * 100);
}

export function missingFields(profile: Partial<Profile>): (keyof ProfileData)[] {
  const data = (profile.data ?? {}) as ProfileData;
  return SCORED.filter((key) => !(data[key] as string)?.trim());
}

/* Normalises a profile on save: trims, enforces caps, drops blank custom
   fields, and guarantees every ProfileData key exists so the form never has to
   deal with a half-built object. */
export function normalizeProfile(profile: Partial<Profile>): Partial<Profile> {
  const incoming = (profile.data ?? {}) as Partial<ProfileData>;
  const data: ProfileData = { ...EMPTY_PROFILE_DATA, customFields: {} };

  for (const key of Object.keys(EMPTY_PROFILE_DATA) as (keyof ProfileData)[]) {
    if (key === 'customFields') continue;
    const value = incoming[key];
    const cap = key === 'rawInfo' ? LIMITS.rawInfo : LIMITS.field;
    (data[key] as string) = typeof value === 'string' ? value.trim().slice(0, cap) : '';
  }

  data.customFields = Object.fromEntries(
    Object.entries(incoming.customFields ?? {})
      .map(([k, v]) => [k.trim().slice(0, LIMITS.customKey), String(v ?? '').trim().slice(0, LIMITS.field)])
      .filter(([k, v]) => k && v)
      .slice(0, LIMITS.customFields),
  );

  return {
    ...profile,
    name: (profile.name ?? '').trim().slice(0, LIMITS.name) || 'Untitled',
    systemPrompt: (profile.systemPrompt ?? '').trim().slice(0, LIMITS.systemPrompt),
    data,
  };
}
