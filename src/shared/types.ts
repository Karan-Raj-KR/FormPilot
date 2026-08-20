// ─── Field Categories ───
export type FieldCategory =
  | 'personal'
  | 'contact'
  | 'address'
  | 'professional'
  | 'education'
  | 'essay'
  | 'project'
  | 'social'
  | 'payment'
  | 'credential'
  | 'other';

// ─── Preferences ───
export type TonePreference = 'formal' | 'casual' | 'bold' | 'professional';
export type LengthPreference = 'concise' | 'moderate' | 'detailed';
// Any key of PROVIDERS in constants.ts. Kept as a string so adding a provider
// is a one-line table entry rather than a type change rippling through the app.
export type AIProvider = string;
export type Page = 'dashboard' | 'home' | 'preview' | 'profiles' | 'settings' | 'history' | 'paymentVault' | 'passwordVault' | 'account' | 'memory';

// How a provider's HTTP API is shaped. Nearly every vendor speaks 'openai'.
export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export interface ProviderSpec {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  models: string[];      // suggestions only — the model field accepts any string
  keyUrl?: string;       // where to get an API key
  keyPlaceholder?: string;
  editableBaseUrl?: boolean;
  note?: string;
}

// Per-provider credentials. baseUrl is only set for custom/self-hosted endpoints.
export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface DetectedField {
  id: string;
  fieldId?: string;
  // Which frame of the tab the element lives in. 0 is the top document; forms
  // embedded in an iframe (Stripe, Typeform, Google Forms) get their own id.
  frameId?: number;
  selector: string;
  fallbackSelector?: string;
  tagName: string;
  type: string; // 'text'|'email'|'tel'|'password'|'textarea'|'select'|'radio'|'checkbox'|'checkbox-group'|'date'|'time'|'number'|…
  label: string;
  placeholder: string;
  name: string;
  ariaLabel: string;
  // The page's own autocomplete hint ('cc-number', 'one-time-code', …).
  autocomplete?: string;
  // Empty for sensitive fields — their real value never leaves the page.
  currentValue: string;
  suggestedValue: string;
  confidence: number;
  category: FieldCategory;
  status: 'pending' | 'generating' | 'ready' | 'filled' | 'skipped' | 'error';
  options?: string[];
  // Where the suggested value came from, so the UI can say so.
  source?: 'ai' | 'memory' | 'vault';
  required?: boolean;
  // Section heading / fieldset the field sits under, used for grouping and as
  // extra context for the model.
  section?: string;
}

// ─── Page context ───
// What the page is about, gathered at scan time and handed to the model so it
// answers "Why do you want to work here?" knowing which company is asking.
export interface PageContext {
  url: string;
  domain: string;
  title: string;
  description: string;
  headings: string[];
  submitLabels: string[];
}

// ─── Memory ───
export interface MemoryFact {
  key: string;      // normalized question, e.g. "first name"
  label: string;    // as it was written on the page
  value: string;
  domain: string;   // '' means it applies everywhere
  hits: number;     // times confirmed — higher is more trusted
  source: 'fill' | 'typed';
  updatedAt: number;
}

// ─── Profile ───
export interface ProfileData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  bio: string;
  company: string;
  role: string;
  website: string;
  linkedin: string;
  github: string;
  twitter: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  skills: string;
  education: string;
  experience: string;
  projects: string;
  rawInfo: string;
  customFields: Record<string, string>;
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  emoji: string;
  data: ProfileData;
  // Standing instructions the user writes for this profile, handed to the model
  // in the system slot. Style guidance only — it cannot override the safety
  // rules in the request.
  systemPrompt?: string;
  tonePreference: TonePreference;
  lengthPreference: LengthPreference;
  createdAt: number;
  updatedAt: number;
}

// ─── Settings ───
export interface Settings {
  aiProvider: AIProvider;
  providers: Record<string, ProviderConfig>;
  defaultTone: TonePreference;
  defaultLength: LengthPreference;
  activeProfileId: string;
  autoDetect: boolean;
  showConfidence: boolean;
  // Watch what the user types into forms and turn it into memory.
  learnFromTyping: boolean;
  // Reuse remembered answers before asking the model.
  useMemory: boolean;
}

// ─── Sync / account ───
// How the user got in. 'password' accounts unlock with the same secret they
// sign in with; 'google' and 'otp' accounts set a separate unlock passphrase,
// because there is no password to derive a key from.
export type AuthMethod = 'google' | 'password' | 'otp';

// Everything here is safe at rest: an email, an opaque session token and a
// public salt. None of it can decrypt anything.
export interface AuthState {
  method: AuthMethod;
  email: string;
  userId: string;
  kdfSalt: string;
  verified: boolean;
  sessionToken: string;   // empty for Google, which mints its own tokens
  expiresAt: number;
  devices?: number;
  hasPassword?: boolean;
  hasGoogle?: boolean;
}

export interface SyncState {
  email: string;
  userId: string;
  lastSyncedAt: number;    // local clock, for display
  remoteUpdatedAt: number; // server clock, sent back as the conflict guard
  lastError?: string;      // why the last automatic attempt failed, if it did
  pendingSince?: number;   // local edits waiting to go up
}

// ─── History ───
export interface FillHistoryEntry {
  id: string;
  domain: string;
  url: string;
  title: string;
  profileId: string;
  profileName: string;
  fieldCount: number;
  filledCount: number;
  fields: Array<{ label: string; value: string; category: FieldCategory }>;
  timestamp: number;
}

// ─── Payment Card ───
export interface PaymentCard {
  id: string;
  nickname: string;
  cardholderName: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  billingAddress?: string;
  billingCity?: string;
  billingZip?: string;
  billingCountry?: string;
  isDefault: boolean;
  createdAt: number;
}

// ─── Password Entry ───
export interface PasswordEntry {
  id: string;
  domain: string;
  username: string;
  password: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Messages between popup / content / background ───
export interface ScanFieldsMessage {
  type: 'SCAN_FIELDS';
}

export interface ScanFieldsResponse {
  fields: DetectedField[];
  context?: PageContext;
}

export interface FillFieldMessage {
  type: 'FILL_FIELD';
  fieldId?: string;
  frameId?: number;
  selector: string;
  fallbackSelector?: string;
  value: string;
  tagName: string;
}

export interface FillAllMessage {
  type: 'FILL_ALL';
  fields: Array<{ selector: string; value: string; tagName: string }>;
}

export interface GenerateFillsMessage {
  type: 'GENERATE_FILLS';
  payload: {
    fields: DetectedField[];
    profile: Profile;
    settings: Settings;
    context?: PageContext;
    memory?: Record<string, string>;
  };
}

export interface GenerateFillsResponse {
  suggestions: Array<{
    index: number;
    value: string;
    confidence: number;
  }>;
  error?: string;
}

export interface HighlightFieldsMessage {
  type: 'HIGHLIGHT_FIELDS';
  selectors: string[];
}

export interface ClearHighlightsMessage {
  type: 'CLEAR_HIGHLIGHTS';
}
