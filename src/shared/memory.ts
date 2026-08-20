/* ─────────────────────────────────────────────────
   FormPilot — Memory
   Everything the extension has learned about the user, keyed by the
   normalized question it answers. Two sources feed it:
     1. values the user accepted (or edited) in a fill
     2. values the user typed into a form themselves
   Sensitive fields never enter memory — those live in the vault.
   ───────────────────────────────────────────────── */
import type { MemoryFact, DetectedField } from './types';
import { getItem, setItem } from './storage.ts';
import { STORAGE_KEYS, MEMORY_LIMIT, SENSITIVE_VALUE, isSensitiveField } from './constants.ts';

// Collapses "First Name *", "first_name", "firstName" onto one key so a fact
// learned on one site answers the same question on the next.
export function memoryKey(...parts: (string | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    // camelCase and PascalCase attribute names split into words first, so
    // "firstName" and "first_name" land on the same key.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(please|your|the|a|an|enter|type|field|required|optional)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A value is worth remembering only if it is stable, non-secret and short
// enough to be a fact rather than an essay.
export function isLearnable(
  field: Pick<DetectedField, 'category' | 'type' | 'label' | 'name'> & { autocomplete?: string },
  value: string,
): boolean {
  if (!value || value.length > 400) return false;
  if (isSensitiveField(field)) return false;
  if (SENSITIVE_VALUE.test(value)) return false;
  if (!memoryKey(field.label, field.name, field.type)) return false;
  return true;
}

export async function getMemory(): Promise<MemoryFact[]> {
  return (await getItem<MemoryFact[]>(STORAGE_KEYS.MEMORY)) ?? [];
}

export async function saveMemory(facts: MemoryFact[]): Promise<void> {
  await setItem(STORAGE_KEYS.MEMORY, facts);
}

export async function clearMemory(): Promise<void> {
  await setItem(STORAGE_KEYS.MEMORY, []);
}

export async function forgetFact(key: string, domain: string): Promise<MemoryFact[]> {
  const facts = (await getMemory()).filter((f) => !(f.key === key && f.domain === domain));
  await saveMemory(facts);
  return facts;
}

/* Records one observation. A fact is stored twice at most: once scoped to the
   domain (site-specific answers like a username) and once globally (the same
   answer everywhere, like a phone number). Domain-scoped wins on lookup. */
export async function remember(
  field: Pick<DetectedField, 'category' | 'type' | 'label' | 'name' | 'placeholder'>,
  value: string,
  domain: string,
  source: MemoryFact['source'] = 'fill',
): Promise<void> {
  if (!isLearnable(field, value)) return;
  const key = memoryKey(field.label, field.name, field.type);
  const facts = await getMemory();

  for (const scope of [domain, '']) {
    const existing = facts.find((f) => f.key === key && f.domain === scope);
    if (existing) {
      // Repeated agreement raises confidence; a changed answer replaces the old
      // one and resets the count, because the user just corrected us.
      existing.hits = existing.value === value ? existing.hits + 1 : 1;
      existing.value = value;
      existing.updatedAt = Date.now();
      existing.source = source;
    } else {
      facts.push({
        key,
        label: field.label || field.name || key,
        value,
        domain: scope,
        hits: 1,
        source,
        updatedAt: Date.now(),
      });
    }
  }

  // ponytail: least-recently-used trim; swap for per-domain quotas if one noisy
  // site ever starves the global facts.
  facts.sort((a, b) => b.updatedAt - a.updatedAt);
  await saveMemory(facts.slice(0, MEMORY_LIMIT));
}

export async function rememberAll(fields: DetectedField[], domain: string, source: MemoryFact['source'] = 'fill'): Promise<void> {
  for (const f of fields) {
    await remember(f, f.suggestedValue, domain, source);
  }
}

// Best known answer for a field: this exact site first, then anywhere.
export function recall(facts: MemoryFact[], field: DetectedField, domain: string): MemoryFact | undefined {
  const key = memoryKey(field.label, field.name, field.type);
  if (!key) return undefined;
  return (
    facts.find((f) => f.key === key && f.domain === domain) ??
    facts.find((f) => f.key === key && f.domain === '')
  );
}

/* The slice of memory worth sending: answers to the questions on screen, and
   nothing else. An earlier version also attached the most-confirmed general
   facts as "background", which meant an answer given on one site was uploaded
   to the model while filling an unrelated one. Only what this form asks for
   leaves the device. */
export function memoryForPrompt(facts: MemoryFact[], fields: DetectedField[], domain: string): Record<string, string> {
  const picked: Record<string, string> = {};

  for (const field of fields) {
    if (isSensitiveField(field)) continue;
    const hit = recall(facts, field, domain);
    if (hit && !SENSITIVE_VALUE.test(hit.value)) picked[hit.label] = hit.value;
  }

  return picked;
}
