import type {
  Profile, ProfileData, Settings, TonePreference, LengthPreference, FieldCategory,
  ProviderSpec, ProviderConfig,
} from './types';

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
  providers: {},
  defaultTone: 'professional',
  defaultLength: 'moderate',
  activeProfileId: 'personal',
  autoDetect: true,
  showConfidence: true,
  learnFromTyping: true,
  useMemory: true,
};

// ─── Providers ───
// Adding a provider is one entry here. Anything exposing an OpenAI-compatible
// /chat/completions endpoint uses kind 'openai' and needs no new request code.
// `models` are suggestions for the datalist — the model field takes any string,
// because OpenRouter and NIM each expose hundreds.
export const PROVIDERS: Record<string, ProviderSpec> = {
  openai: {
    name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    keyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-…',
  },
  anthropic: {
    name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys', keyPlaceholder: 'sk-ant-…',
  },
  gemini: {
    name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    keyUrl: 'https://aistudio.google.com/app/apikey', keyPlaceholder: 'AIzaSy…',
  },
  groq: {
    name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    keyUrl: 'https://console.groq.com/keys', keyPlaceholder: 'gsk_…',
  },
  openrouter: {
    name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    models: ['anthropic/claude-sonnet-5', 'openai/gpt-4o', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
    keyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-…',
    note: 'One key, hundreds of models. Paste any model id from openrouter.ai/models.',
  },
  nvidia: {
    name: 'NVIDIA NIM', kind: 'openai', baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'deepseek-ai/deepseek-r1'],
    keyUrl: 'https://build.nvidia.com', keyPlaceholder: 'nvapi-…',
    note: 'Model ids come from build.nvidia.com — use the exact string shown there.',
  },
  deepseek: {
    name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'sk-…',
  },
  mistral: {
    name: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys', keyPlaceholder: '…',
  },
  together: {
    name: 'Together AI', kind: 'openai', baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'],
    keyUrl: 'https://api.together.xyz/settings/api-keys', keyPlaceholder: '…',
  },
  xai: {
    name: 'xAI Grok', kind: 'openai', baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3-mini'],
    keyUrl: 'https://console.x.ai', keyPlaceholder: 'xai-…',
  },
  fireworks: {
    name: 'Fireworks', kind: 'openai', baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
    keyUrl: 'https://fireworks.ai/account/api-keys', keyPlaceholder: 'fw_…',
  },
  ollama: {
    name: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5', 'mistral'],
    keyPlaceholder: 'not required', editableBaseUrl: true,
    note: 'Runs on your machine. Start it with OLLAMA_ORIGINS=chrome-extension://* ollama serve',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '',
    models: [], keyPlaceholder: 'your API key', editableBaseUrl: true,
    note: 'Any endpoint exposing POST /chat/completions. Give the base URL up to and including /v1.',
  },
};

// Resolves the credentials + endpoint for a provider, falling back to the
// registry defaults. Single source of truth for background and Settings alike.
export function getProviderConfig(
  settings: Settings,
  id: string = settings.aiProvider,
): ProviderConfig & { id: string; spec: ProviderSpec } {
  const spec = PROVIDERS[id] ?? PROVIDERS.openai;
  const saved = settings.providers?.[id] ?? { apiKey: '', model: '' };
  return {
    id,
    spec,
    apiKey: saved.apiKey ?? '',
    model: saved.model || spec.models[0] || '',
    baseUrl: (saved.baseUrl || spec.baseUrl || '').replace(/\/+$/, ''),
  };
}

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
  SYNC_STATE: 'formpilot_sync_state',
  MEMORY: 'formpilot_memory',
} as const;

// How many learned facts to keep. Well under chrome.storage.local's 10MB.
export const MEMORY_LIMIT = 600;

// Values that must never be learned, stored in history, or put in a prompt.
// Deliberately over-broad: refusing to memorise a postal code costs nothing,
// leaking a one-time passcode or an account number cannot be undone.
export const SENSITIVE_VALUE = new RegExp([
  '^\\s*(?:\\d[ -]?){12,19}\\s*$',              // card / bank account numbers
  '^\\s*\\d{3,4}\\s*$',                          // CVV, short PIN
  '^\\s*\\d{5,8}\\s*$',                          // one-time codes
  '^\\s*\\d{3}-\\d{2}-\\d{4}\\s*$',             // US SSN
  '^\\s*[A-Z]{2}\\d{2}[A-Z0-9]{10,30}\\s*$',      // IBAN
  '\\b(?:password|passcode|secret|api[ _-]?key|token|otp|one[ -]?time|verification code|security code|ssn|social security|sort code|routing|iban|swift|account number|passport|licen[cs]e number|tax id|national insurance|aadhaar|pan number|cvv|cvc|pin)\\b',
].join('|'), 'i');

// The browser's own autocomplete hint is the most reliable sensitivity signal
// on the page, and it costs nothing to read.
export const SENSITIVE_AUTOCOMPLETE = /^(?:cc-|new-password|current-password|one-time-code)/i;

// What replaces a sensitive value anywhere it would otherwise be exposed.
export const REDACTED = '[redacted]';

// True when this field's existing value must not leave the device — used before
// anything is handed to a model, written to history, or learned.
export function isSensitiveField(
  field: { category?: string; type?: string; label?: string; name?: string; autocomplete?: string },
): boolean {
  if (field.category === 'payment' || field.category === 'credential') return true;
  if (field.type === 'password') return true;
  if (field.autocomplete && SENSITIVE_AUTOCOMPLETE.test(field.autocomplete)) return true;
  return SENSITIVE_VALUE.test(`${field.label ?? ''} ${field.name ?? ''}`);
}

// Model ids that vendors have retired — cleared from saved settings on read so
// an upgraded install doesn't keep calling an endpoint that now 404s.
export const RETIRED_MODEL_IDS = [
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'mixtral-8x7b-32768',
  'gemini-1.5-pro',
  'gemini-1.5-flash',
];

// ─── Category inference ───
// Lives here rather than in the content script so it stays free of DOM access
// and can be exercised by test-detection.mjs.
export function inferCategory(label: string, type: string, name: string, autocomplete = ''): FieldCategory {
  const combined = `${label} ${name} ${type}`.toLowerCase();

  // The page's own autocomplete hint is authoritative when present.
  if (/^cc-/i.test(autocomplete)) return 'payment';
  if (/^(new-password|current-password)$/i.test(autocomplete)) return 'credential';
  if (/^username$/i.test(autocomplete)) return 'credential';

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
