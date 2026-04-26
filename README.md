<div align="center">

# 🤖 FormPilot

### The AI-powered Chrome Extension that actually understands your forms.

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/Karan-Raj-KR/FormPilot-)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

**Stop typing. Start doing.**

*FormPilot scans any web form, understands its context using LLMs, and fills every field intelligently — from your name to a 500-word cover letter.*

</div>

---

## 🧠 The Problem

Every developer, student, and professional wastes hours per week filling repetitive web forms — job applications, hackathon registrations, surveys, checkout pages, onboarding flows.

**Browser autofill is dumb.** It pattern-matches field names. It fails on React/Vue apps. It can't write your cover letter. It has zero context.

**FormPilot is different.**

---

## ⚡ What Makes It Different

| Feature | Browser Autofill | FormPilot |
|--------|-----------------|-------------|
| Understands field *context* | ❌ | ✅ Uses LLM |
| Fills essay / textarea fields | ❌ | ✅ Generates content |
| Works on React / Vue SPAs | ❌ Often breaks | ✅ Native setter bypass |
| Supports dropdowns semantically | ❌ | ✅ Matches by meaning |
| Multiple profiles (Personal/Work) | ❌ | ✅ |
| Confidence scoring per field | ❌ | ✅ |
| Payment vault + Password vault | ❌ | ✅ |
| Your choice of AI model | ❌ | ✅ GPT-4o, Claude, Gemini, Groq |
| Zero data sent to any server | ❌ | ✅ 100% local |

---

## 🎬 Demo

> *Demo video link coming soon — see the extension in action on Google Forms and job portals.*

---

## 📸 Screenshots

<div align="center">
<table>
<tr>
<td align="center"><b>Dashboard</b></td>
<td align="center"><b>Scan Page</b></td>
<td align="center"><b>Profiles</b></td>
</tr>
<tr>
<td><img src="docs/screenshots/dashboard.png" width="220"/></td>
<td><img src="docs/screenshots/scan.png" width="220"/></td>
<td><img src="docs/screenshots/profiles.png" width="220"/></td>
</tr>
<tr>
<td align="center"><b>Vault</b></td>
<td align="center"><b>History</b></td>
<td align="center"><b>Settings</b></td>
</tr>
<tr>
<td><img src="docs/screenshots/vault.png" width="220"/></td>
<td><img src="docs/screenshots/history.png" width="220"/></td>
<td><img src="docs/screenshots/settings.png" width="220"/></td>
</tr>
</table>
</div>

---

## 🏗️ Architecture

FormPilot is a **Manifest V3** Chrome Extension with 3 isolated layers:

```
┌─────────────────────────────────────────────────────────┐
│                    POPUP (React SPA)                     │
│  Dashboard · Scan · Preview · Profiles · Vault · History │
└──────────────┬──────────────────────┬───────────────────┘
               │ chrome.runtime       │ chrome.tabs
               ▼                      ▼
┌──────────────────────┐  ┌───────────────────────────────┐
│  BACKGROUND WORKER   │  │      CONTENT SCRIPT           │
│                      │  │                               │
│  · Builds AI prompt  │  │  · Scans DOM (10-layer label  │
│  · Calls AI API      │  │    extraction strategy)       │
│  · Parses response   │  │  · Injects values             │
│  · 4 providers       │  │  · React/Vue-safe native      │
│    (OpenAI, Claude,  │  │    setter bypass              │
│     Gemini, Groq)    │  │  · Visual feedback CSS        │
└──────────────────────┘  └───────────────────────────────┘
```

### How a Fill Works

```
1. User clicks "Scan Page"
      → Content script queries all input/textarea/select/ARIA elements
      → 10-priority label extraction (aria-label → fieldset/legend → sibling text → ...)
      → Fields categorized: personal / contact / address / professional / essay / ...
      → Returns DetectedField[] with selector, label, type, confidence

2. User clicks "Review & Auto-fill"
      → Background builds structured prompt with profile data + field list
      → AI returns { suggestions: [{ index, value, confidence }] }
      → Payment fields → matched from Vault's default card
      → Credential fields → matched from password vault by domain

3. User clicks "Auto-Fill All Forms"
      → Each field: focus → native setter → input/change/blur events fired
      → React synthetic event system triggered correctly
      → Green glow animation on filled fields
      → History entry logged
```

---

## 🔐 Privacy & Security

- **Zero telemetry.** No analytics. No tracking.
- **API keys stored locally** in `chrome.storage.local` — sandboxed to this extension.
- **API calls go directly** from your browser to the AI provider. No relay server.
- **Keys sanitized** before sending (strips hidden unicode characters).
- **Message validation** — background/content scripts reject any message not from `chrome.runtime.id`.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| UI | React 18 + TypeScript |
| Styling | TailwindCSS 3 + Custom glassmorphism design system |
| Animation | Framer Motion |
| Icons | Lucide React |
| Popup bundler | Vite 5 |
| Content/BG bundler | esbuild |
| Storage | chrome.storage.local (localStorage fallback in dev) |
| AI Providers | OpenAI, Anthropic Claude, Google Gemini, Groq |
| Extension standard | Chrome Manifest V3 |

---

## 🚀 Installation (Development)

```bash
# 1. Clone
git clone https://github.com/Karan-Raj-KR/FormPilot-.git
cd FormPilot-

# 2. Install dependencies
npm install

# 3. Build
npm run build
# This runs: vite build (popup) + esbuild (content + background)

# 4. Load in Chrome
# → Open chrome://extensions
# → Enable "Developer mode" (top right)
# → Click "Load unpacked"
# → Select the /dist folder
```

---

## 🔑 Setup (First Use)

1. Open the extension → click **Settings**
2. Choose your AI provider (Groq is free to start)
3. Paste your API key (stored locally, never leaves your browser)
4. Go to **Profiles** → fill in your info (or paste your entire resume in "Raw Info")
5. Navigate to any form → click **Scan** → click **Auto-Fill**

---

## 🤖 Supported AI Providers

| Provider | Default Model | Speed | Cost |
|----------|--------------|-------|------|
| **Groq** (Llama 3.3 70B) | llama-3.3-70b-versatile | ⚡ Fastest | Free tier |
| **Google Gemini** | gemini-2.5-flash | ⚡ Fast | Free tier |
| **OpenAI** | gpt-4o | 🔵 Best accuracy | Paid |
| **Anthropic Claude** | claude-3-7-sonnet | 🔵 Best reasoning | Paid |

> All providers use `temperature: 0.3` for consistent, accurate fills.

---

## 📁 Project Structure

```
FormPilot/
├── src/
│   ├── background/index.ts     ← Service worker: AI calls + prompt builder
│   ├── content/
│   │   ├── index.ts            ← DOM scanner + field filler + MutationObserver
│   │   └── styles.css          ← Visual feedback (green glow, purple highlights)
│   ├── popup/
│   │   ├── App.tsx             ← Root component + state
│   │   └── pages/
│   │       ├── Dashboard.tsx   ← Onboarding guide
│   │       ├── Home.tsx        ← Scan + field category grid
│   │       ├── Preview.tsx     ← AI generation + per-field editing + fill
│   │       ├── Profiles.tsx    ← Create/edit/switch profiles
│   │       ├── Settings.tsx    ← API key + model + toggles
│   │       └── History.tsx     ← Past fill sessions
│   └── shared/
│       ├── types.ts            ← All TypeScript interfaces
│       ├── constants.ts        ← Defaults, model lists, storage keys
│       ├── storage.ts          ← Chrome storage abstraction
│       ├── auth.ts             ← Google OAuth
│       └── sync.ts             ← Cross-device profile backup
├── public/manifest.json        ← Chrome Extension MV3 config
├── vite.config.ts
└── build-scripts.mjs           ← esbuild stage for content + background
```

---

## 👥 Team

Built with ☕ and zero sleep at **[Hackathon Name]**

| | Name | Role |
|-|------|------|
| 👨‍💻 | **Karan Raj** | 
| 👨‍💻 | **Saagnik** | 
| 👨‍💻 | **Havinash** | 

---

## 📄 License

MIT © 2025 FormPilot Team

---

<div align="center">

**If you've ever rage-quit a form, this is for you.**

⭐ Star this repo if it saved you time

</div>
