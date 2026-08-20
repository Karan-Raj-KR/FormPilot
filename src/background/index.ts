import { getProviderConfig } from '../shared/constants';

/* ─────────────────────────────────────────────────
   FormPilot — Background Service Worker
   Handles AI API calls and profile/history storage.
   ───────────────────────────────────────────────── */

// ─── Build the AI prompt ───
function buildPrompt(fields: any[], profile: any, settings: any): string {
  const profileData = profile.data;
  const tone = settings.defaultTone || profile.tonePreference || 'professional';
  const length = settings.defaultLength || profile.lengthPreference || 'moderate';

  const cleanProfile = Object.entries(profileData).reduce((acc: any, [k, v]) => {
    if (v && typeof v === 'string' && v.trim() !== '') {
      acc[k] = v;
    }
    return acc;
  }, {});

  if (profileData.customFields) {
    Object.entries(profileData.customFields).forEach(([k, v]) => {
      if (v) cleanProfile[k] = v;
    });
  }

  const cleanFields = fields.map((f, i) => ({
    index: i,
    label: f.label,
    name: f.name,
    type: f.type,
    placeholder: f.placeholder,
    options: f.options
  }));

  return `You are an intelligent AI form filler. 

## User Profile Data
\`\`\`json
${JSON.stringify(cleanProfile, null, 2)}
\`\`\`

## Response Constraints
- Tone: ${tone}
- Length: ${length}

## Form Fields To Fill
\`\`\`json
${JSON.stringify(cleanFields, null, 2)}
\`\`\`

## INSTRUCTIONS
1. Analyze the User Profile Data heavily.
2. For each Form Field, determine the best value from the profile data.
3. If it is a name, email, or phone field, use EXACT values. Do not invent details.
4. If it is a dropdown (has options), you MUST select the exact string from the options array.
5. If it requires a paragraph/essay, use the Tone/Length constraint and generate a rich answer using the profile's rawInfo or experience.
6. If the field is a checkbox or radio button, output exactly "true" or "false" based on whether it should be selected.
7. If the field type is "date", you MUST output the value exactly in "YYYY-MM-DD" format.
8. If the field type is "time", you MUST output the value exactly in "HH:MM" (24-hour) format.
9. If the profile doesn't have the info, leave value as an empty string "".

CRITICAL: Respond ONLY with a valid JSON object matching this schema exactly (no markdown formatting or text outside the JSON):
{
  "suggestions": [
    { "index": <number>, "value": "<string>", "confidence": <float> }
  ]
}`;
}

// ─── OpenAI-compatible chat completions ───
// OpenAI, Groq, OpenRouter, NVIDIA NIM, DeepSeek, Mistral, Together, xAI,
// Fireworks, Ollama and any custom endpoint all speak this exact shape, so
// they share one function. Only the base URL and key differ.
async function callOpenAICompatible(prompt: string, apiKey: string, model: string, baseUrl: string) {
  if (!baseUrl) throw new Error('No API endpoint configured for this provider. Add a base URL in Settings.');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      // Ignored by every other vendor; OpenRouter uses them for attribution.
      'HTTP-Referer': 'https://github.com/Karan-Raj-KR/FormPilot',
      'X-Title': 'FormPilot',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a precise form-filling assistant. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const message = err.error?.message || err.message || `Request failed (${response.status})`;
    // Not every OpenAI-compatible server implements JSON mode; retry without it
    // rather than failing the whole fill.
    if (/response_format|json_object/i.test(message)) {
      return callOpenAICompatibleNoJsonMode(prompt, apiKey, model, baseUrl);
    }
    throw new Error(message);
  }

  const data = await response.json();
  return parseAIResponse(data.choices?.[0]?.message?.content || '');
}

async function callOpenAICompatibleNoJsonMode(prompt: string, apiKey: string, model: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a precise form-filling assistant. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || err.message || `Request failed (${response.status})`);
  }
  const data = await response.json();
  return parseAIResponse(data.choices?.[0]?.message?.content || '');
}

// ─── Call Anthropic API ───
async function callAnthropic(prompt: string, apiKey: string, model: string, baseUrl: string) {
  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-opus-5',
      // Current models think before answering; 4096 can be consumed by reasoning
      // and truncate the JSON body mid-object.
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return parseAIResponse(data.content?.[0]?.text || '');
}

// ─── Call Gemini API ───
async function callGemini(prompt: string, apiKey: string, model: string, baseUrl: string, attempt: number = 1): Promise<{ suggestions: any[] }> {
  const safeModel = (model && model.includes('gemini')) ? model : 'gemini-2.5-flash';

  try {
    const response = await fetch(`${baseUrl}/models/${safeModel}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a precise form-filling assistant. Always respond with valid JSON only.\n\n${prompt}` }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      if ((response.status === 503 || response.status === 429) && attempt < 4) {
        // Exponential backoff for the "model is overloaded" spikes.
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        return callGemini(prompt, apiKey, model, baseUrl, attempt + 1);
      }
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    return parseAIResponse(data.candidates?.[0]?.content?.parts?.[0]?.text || '');
  } catch (error: any) {
    if (attempt < 4 && (error.message.includes('fetch') || error.message.includes('Network'))) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      return callGemini(prompt, apiKey, model, baseUrl, attempt + 1);
    }
    throw error;
  }
}

// ─── Parse AI response (extract JSON) ───
function parseAIResponse(content: string): { suggestions: any[] } {
  // Every candidate is tried, not just the ones after a thrown parse error:
  // a model that answers with a bare array parses fine yet has no `suggestions`.
  const candidates = [
    content,
    content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    content.match(/\{[\s\S]*"suggestions"[\s\S]*\}/)?.[0],
    content.match(/\[[\s\S]*\]/)?.[0],
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate.trim());
      if (Array.isArray(parsed)) return { suggestions: parsed };
      if (Array.isArray(parsed.suggestions)) return parsed;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('Failed to parse AI response. Please try again.');
}

// ─── Message handler ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security check: strictly verify sender is the extension itself
  if (sender.id !== chrome.runtime.id) {
    console.warn('Blocked unauthorized message from:', sender.origin);
    return false;
  }

  if (message.type === 'GENERATE_FILLS') {
    const { fields, profile, settings } = message.payload;
    const prompt = buildPrompt(fields, profile, settings);

    // Sanitize API keys to remove hidden unicode chars (like zero-width spaces) that break HTTP headers
    const sanitizeKey = (key: string | undefined) => (key || '').replace(/[^\x20-\x7E]/g, '').trim();
    const { spec, apiKey, model, baseUrl } = getProviderConfig(settings);
    const key = sanitizeKey(apiKey);

    let apiCall: Promise<{ suggestions: any[] }>;
    if (spec.kind === 'gemini') {
      apiCall = callGemini(prompt, key, model, baseUrl!);
    } else if (spec.kind === 'anthropic') {
      apiCall = callAnthropic(prompt, key, model, baseUrl!);
    } else {
      apiCall = callOpenAICompatible(prompt, key, model, baseUrl!);
    }

    apiCall
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ suggestions: [], error: error.message }));

    return true; // keep channel open for async response
  }
});

// ─── Extension install handler ───
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('FormPilot installed successfully');
    chrome.tabs.create({ url: chrome.runtime.getURL('landing.html') });
  }
});
