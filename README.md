# Form-Fill-AI 🤖


	⁠AI-powered Chrome extension that scans web forms and fills them intelligently using your profile data.

---

## What it does 📕

Form-Fill-AI detects form fields on any webpage, sends them to an AI model with your saved profile, and fills them with contextually accurate values — including cover letters, dropdowns, and multi-step forms.

---

## Features 🚀

•⁠  ⁠*Multi-provider AI* — OpenAI, Anthropic, Gemini, Groq (switch anytime)
•⁠  ⁠*Smart field detection* — 5-layer label extraction, 9 field categories
•⁠  ⁠*Per-field confidence scores* — know what the AI is uncertain about
•⁠  ⁠*Profile system* — multiple profiles (Personal, Work, Dev) with tone & length preferences
•⁠  ⁠*Raw info field* — paste your full resume, AI mines it for any field
•⁠  ⁠*Fill history* — every session logged by domain with full drill-down
•⁠  ⁠*Cross-device sync* — profiles synced via ⁠ chrome.storage.sync ⁠
•⁠  ⁠*Google OAuth* — sign in to enable cloud sync
•⁠  ⁠*Visual feedback* — highlight, fill, error states injected into host pages

---

## Supported AI Providers ⚙️

| Provider  | Default Model                  | Alternatives                              |
|-----------|-------------------------------|-------------------------------------------|
| OpenAI    | ⁠ gpt-4o ⁠                      | ⁠ gpt-4o-mini ⁠, ⁠ gpt-4-turbo ⁠             |
| Anthropic | ⁠ claude-3-7-sonnet-20250219 ⁠  | ⁠ claude-3-5-sonnet ⁠, ⁠ claude-3-5-haiku ⁠  |
| Gemini    | ⁠ gemini-2.5-flash ⁠            | ⁠ gemini-2.0-flash ⁠                        |
| Groq      | ⁠ llama-3.3-70b-versatile ⁠     | ⁠ mixtral-8x7b-32768 ⁠                      |

All providers use ⁠ temperature: 0.3 ⁠ for consistent, accurate outputs.

---

## How it works 📕


User clicks Scan
  └── Popup → Content Script: SCAN_FIELDS
        └── DOM scanner detects fields (input, textarea, select)
              └── Returns DetectedField[] with label, type, selector, category

User clicks Review & Auto-fill
  └── Popup → Background: GENERATE_FILLS
        └── Builds prompt with profile data + field metadata
              └── Calls AI provider API
                    └── Returns { suggestions: [{ index, value, confidence }] }

User clicks Fill All
  └── Popup → Content Script: FILL_FIELD (per field, 150ms apart)
        └── Finds element via data-formfill-id → CSS selector → fallback
              └── Fires native setter + input/change/blur events
                    └── Green glow animation on success


---

## Architecture 🏛️


Form-Fill-AI/
├── src/
│   ├── background/index.ts      ← Service worker: AI calls + prompt builder
│   ├── content/
│   │   ├── index.ts             ← DOM scanner + field filler + MutationObserver
│   │   └── styles.css           ← Visual feedback injected into host pages
│   ├── popup/
│   │   ├── App.tsx              ← Root component, router, state
│   │   └── pages/
│   │       ├── Dashboard.tsx    ← Onboarding (3-step checklist)
│   │       ├── Home.tsx         ← Scan + field category grid
│   │       ├── Preview.tsx      ← AI generation + per-field edit + fill
│   │       ├── Profiles.tsx     ← Create/edit/switch profiles
│   │       ├── Settings.tsx     ← API key + model + behavior toggles
│   │       └── History.tsx      ← Past sessions with drill-down
│   └── shared/
│       ├── types.ts             ← TypeScript interfaces
│       ├── constants.ts         ← Defaults, models, categories
│       ├── storage.ts           ← Chrome storage + localStorage fallback
│       ├── auth.ts              ← Google OAuth
│       └── sync.ts              ← Cross-device profile sync
├── public/manifest.json         ← Chrome Extension MV3 config
└── vite.config.ts


---

## Build System ⚙️

Two-stage pipeline:

*Stage 1 — Vite*
•⁠  ⁠Builds the React popup app
•⁠  ⁠Obfuscates all ⁠ .ts/.tsx ⁠ files (base64+RC4 string encoding, control flow flattening, dead code injection)

*Stage 2 — esbuild*
•⁠  ⁠⁠ content.ts ⁠ → ⁠ dist/content.js ⁠ (IIFE, fully obfuscated)
•⁠  ⁠⁠ background.ts ⁠ → ⁠ dist/background.js ⁠ (IIFE, minified only)
  - Chrome MV3 service workers reject obfuscation (error code 15) — background is minified only

⁠ bash
npm run build
 ⁠

---

## Installation (Development)

⁠ bash
git clone https://github.com/Karan-Raj-KR/form-fill-ai
cd form-fill-ai
npm install
npm run build
 ⁠

1.⁠ ⁠Open ⁠ chrome://extensions ⁠
2.⁠ ⁠Enable *Developer mode*
3.⁠ ⁠Click *Load unpacked* → select the ⁠ dist/ ⁠ folder

---

## Setup

1.⁠ ⁠Go to *Settings* → enter your AI provider API key
2.⁠ ⁠Go to *Profiles* → fill in your info (or paste your resume in Raw Info)
3.⁠ ⁠Navigate to any form → open the extension → click *Scan*

---

## Privacy 🔐

•⁠  ⁠API keys are stored locally in ⁠ chrome.storage.local ⁠ only — never transmitted to our servers
•⁠  ⁠Profile data leaves your device only to call the AI provider you configured
•⁠  ⁠Fill history is stored locally (max 100 entries)
•⁠  ⁠Cloud sync (optional) uses Chrome's native ⁠ chrome.storage.sync ⁠

---

## Tech Stack

•⁠  ⁠*React + TypeScript* — popup UI
•⁠  ⁠*Vite* — build tooling
•⁠  ⁠*esbuild* — content/background script bundling
•⁠  ⁠*Chrome Extension MV3* — extension platform
•⁠  ⁠*chrome.identity* — Google OAuth
•⁠  ⁠*javascript-obfuscator* — IP protection

---

## License

MIT
