import type { Profile, ProfileData, Settings, TonePreference, LengthPreference, FieldCategory } from './types';

// ─── Default Profile Data ───
export const EMPTY_PROFILE_DATA: ProfileData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  bio: '',
  company: '',
  role: '',
  website: '',
  linkedin: '',
  github: '',
  twitter: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
  skills: '',
  education: '',
  experience: '',
  projects: '',
  rawInfo: '',
  customFields: {},
};

// ─── Profile Presets ───
export const PROFILE_COLORS = [
  '#0ea5e9', // sky blue
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

export const PROFILE_EMOJIS = ['👤', '💼', '🎨', '🚀', '💡', '🎯', '⚡', '🌟'];

export const DEFAULT_PROFILES: Profile[] = [
  {
    id: 'personal',
    name: 'Personal',
    color: '#0ea5e9',
    emoji: '👤',
    data: { ...EMPTY_PROFILE_DATA },
    tonePreference: 'casual',
    lengthPreference: 'moderate',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'work',
    name: 'Work',
    color: '#3b82f6',
    emoji: '💼',
    data: { ...EMPTY_PROFILE_DATA },
    tonePreference: 'professional',
    lengthPreference: 'moderate',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

// ─── Default Settings ───
export const DEFAULT_SETTINGS: Settings = {
  aiProvider: 'openai',
  openaiApiKey: '',
  anthropicApiKey: '',
  geminiApiKey: '',
  groqApiKey: '',
  openaiModel: 'gpt-4o',
  anthropicModel: 'claude-opus-5',
  geminiModel: 'gemini-2.5-flash',
  groqModel: 'llama-3.3-70b-versatile',
  defaultTone: 'professional',
  defaultLength: 'moderate',
  activeProfileId: 'personal',
  autoDetect: true,
  showConfidence: true,
};

// ─── Model Options ───
export const OPENAI_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Most capable' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & affordable' },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous gen' },
];

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5', name: 'Claude Opus 5', description: 'Most capable' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', description: 'Excellent balance' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest & cheapest' },
];

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fastest & most stable' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Next generation speed' }
];

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Best balance' },
  { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Extremely fast' }
];

// ─── Tone Options ───
export const TONE_OPTIONS: { id: TonePreference; label: string; icon: string }[] = [
  { id: 'formal', label: 'Formal', icon: '🎩' },
  { id: 'casual', label: 'Casual', icon: '😎' },
  { id: 'bold', label: 'Bold', icon: '🔥' },
  { id: 'professional', label: 'Professional', icon: '💼' },
];

// ─── Length Options ───
export const LENGTH_OPTIONS: { id: LengthPreference; label: string; icon: string }[] = [
  { id: 'concise', label: 'Concise', icon: '⚡' },
  { id: 'moderate', label: 'Moderate', icon: '📝' },
  { id: 'detailed', label: 'Detailed', icon: '📖' },
];

// ─── Category Config ───
export const CATEGORY_CONFIG: Record<FieldCategory, { label: string; icon: string; color: string }> = {
  personal: { label: 'Personal', icon: '👤', color: '#0ea5e9' },
  contact: { label: 'Contact', icon: '📧', color: '#3b82f6' },
  address: { label: 'Address', icon: '📍', color: '#22c55e' },
  professional: { label: 'Professional', icon: '💼', color: '#f59e0b' },
  education: { label: 'Education', icon: '🎓', color: '#06b6d4' },
  essay: { label: 'Essay / Open', icon: '✍️', color: '#ec4899' },
  project: { label: 'Project', icon: '🚀', color: '#f97316' },
  social: { label: 'Social', icon: '🔗', color: '#6366f1' },
  payment: { label: 'Payment', icon: '💳', color: '#10b981' },
  credential: { label: 'Credential', icon: '🔑', color: '#8b5cf6' },
  other: { label: 'Other', icon: '📋', color: '#6b7280' },
};

// ─── Storage Keys ───
export const STORAGE_KEYS = {
  PROFILES: 'formpilot_profiles',
  SETTINGS: 'formpilot_settings',
  HISTORY: 'formpilot_history',
  PAYMENT_CARDS: 'formpilot_payment_cards',
  PASSWORDS: 'formpilot_passwords',
} as const;

// ─── Category inference ───
// Lives here rather than in the content script so it stays free of DOM access
// and can be exercised by test-detection.mjs.
export function inferCategory(label: string, type: string, name: string): FieldCategory {
  const combined = `${label} ${name} ${type}`.toLowerCase();

  // Sensitive categories must win over the generic ones below — "Name on card"
  // otherwise matches /name/ and gets treated as a personal field.
  if (type === 'password') return 'credential';
  if (/^(user\s?name|username|login|user id)$/i.test(label.trim()) || /^(username|userid|login)$/i.test(name)) return 'credential';
  if (/card|cvv|cvc|security\s*code|expir|\bexp\b/i.test(combined)) return 'payment';

  if (/email/i.test(combined)) return 'contact';
  if (/phone|tel|mobile/i.test(combined)) return 'contact';
  if (/first\s?name|last\s?name|full\s?name|^name$/i.test(combined)) return 'personal';
  if (/address|street|apt|suite/i.test(combined)) return 'address';
  if (/city|state|province|zip|postal|country/i.test(combined)) return 'address';
  if (/linkedin|github|twitter|website|portfolio|url/i.test(combined)) return 'social';
  // Question-shaped labels first: "Why do you want this job?" is an essay
  // prompt, not a job-title field.
  if (/describe|tell\s?us|why|essay|motivation|cover\s*letter|\?$/i.test(combined)) return 'essay';
  if (/company|organization|employer|role|title|position|job/i.test(combined)) return 'professional';
  if (/school|university|college|degree|gpa|education|major/i.test(combined)) return 'education';
  if (/project|about|bio|summary|cover/i.test(combined)) return 'essay';
  if (/skill|technology|stack|experience/i.test(combined)) return 'professional';

  if (type === 'textarea') return 'essay';
  return 'other';
}

// Order matters — getCardValueForField tests these top to bottom, and the loose
// patterns ("card") would otherwise swallow the specific ones ("name on card").
export const PAYMENT_FIELD_PATTERNS = {
  cvv: /cvv|cvc|security\s*code/i,
  cardholderName: /name.*on.*card|card.*holder|holder.*name/i,
  expiryMonth: /exp\w*\s*month|month/i,
  expiryYear: /exp\w*\s*year|year/i,
  expiryFull: /exp\w*\s*date|expiry|expiration|\bexp\b|mm\s*\/\s*yy/i,
  cardNumber: /card\s*number|cc\s*num|credit\s*card|^card$|\bcard\b/i,
};
