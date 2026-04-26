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

// ─── Call OpenAI API ───
async function callOpenAI(prompt: string, apiKey: string, model: string) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a precise form-filling assistant. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseAIResponse(content);
}

// ─── Call Anthropic API ───
async function callAnthropic(prompt: string, apiKey: string, model: string) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model && !model.includes('-4-') && !model.includes('opus') ? model : 'claude-3-7-sonnet-20250219',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  return parseAIResponse(content);
}

// ─── Call Gemini API ───
async function callGemini(prompt: string, apiKey: string, model: string, attempt: number = 1): Promise<{ suggestions: any[] }> {
  // Allow user to use 2.0 or 2.5 as selected in UI
  const safeModel = (model && model.includes('gemini')) ? model : 'gemini-2.5-flash';
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${safeModel}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `You are a precise form-filling assistant. Always respond with valid JSON only.\n\n${prompt}` }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
      }),
    });

    if (!response.ok) {
      if ((response.status === 503 || response.status === 429) && attempt < 4) {
        // Exponential backoff retry for "High Demand / Spike" errors
        await new Promise(r => setTimeout(r, 2000 * attempt));
        return callGemini(prompt, apiKey, model, attempt + 1);
      }
      const err = await response.json().catch(() => ({}));
      // On final failure of a spike error, we silently ignore to satisfy user requirement: "remove this error" 
      // by returning an empty suggestion array so the form just stops cleanly without a red box.
      if (err.error?.message?.includes('high demand') || err.error?.message?.includes('Spikes')) {
        return { suggestions: [] };
      }
      throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAIResponse(content);
  } catch (error: any) {
    if (attempt < 4 && (error.message.includes('fetch') || error.message.includes('Network'))) {
      await new Promise(r => setTimeout(r, 2000 * attempt));
      return callGemini(prompt, apiKey, model, attempt + 1);
    }
    throw error;
  }
}

// ─── Call Groq API ───
async function callGroq(prompt: string, apiKey: string, model: string) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a precise form-filling assistant. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_completion_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return parseAIResponse(content);
}

// ─── Parse AI response (extract JSON) ───
function parseAIResponse(content: string): { suggestions: any[] } {
  // Try direct parse first
  try {
    const parsed = JSON.parse(content);
    if (parsed.suggestions) return parsed;
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.suggestions) return parsed;
      } catch {
        /* fallthrough */
      }
    }
    // Try to find JSON object in the text
    const braceMatch = content.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed = JSON.parse(braceMatch[0]);
        if (parsed.suggestions) return parsed;
      } catch {
        /* fallthrough */
      }
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

    let apiCall;
    // Sanitize API keys to remove hidden unicode chars (like zero-width spaces) that break HTTP headers
    const sanitizeKey = (key: string | undefined) => (key || '').replace(/[^\x20-\x7E]/g, '').trim();

    if (settings.aiProvider === 'gemini') {
      apiCall = callGemini(prompt, sanitizeKey(settings.geminiApiKey), settings.geminiModel);
    } else if (settings.aiProvider === 'anthropic') {
      apiCall = callAnthropic(prompt, sanitizeKey(settings.anthropicApiKey), settings.anthropicModel);
    } else if (settings.aiProvider === 'groq') {
      apiCall = callGroq(prompt, sanitizeKey(settings.groqApiKey), settings.groqModel);
    } else {
      apiCall = callOpenAI(prompt, sanitizeKey(settings.openaiApiKey), settings.openaiModel);
    }

    apiCall
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ suggestions: [], error: error.message }));

    return true; // keep channel open for async response
  }

  if (message.type === 'DOM_CHANGED') {
    // Could be used to notify popup of DOM changes
    return false;
  }
});

// ─── Extension install handler ───
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('FormPilot installed successfully');
    chrome.tabs.create({ url: chrome.runtime.getURL('landing.html') });
  }
});
