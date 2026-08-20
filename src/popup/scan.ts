/* ─────────────────────────────────────────────────
   FormPilot — Tab scanning & filling
   One place that knows how to reach every frame of the active tab.
   ───────────────────────────────────────────────── */
import type { DetectedField, PageContext } from '../shared/types';

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  if (/^(chrome|edge|about|chrome-extension|devtools):/.test(tab.url ?? '')) {
    throw new Error('Browser pages are off limits to extensions. Open a normal website and try again.');
  }
  return tab;
}

/* Runs one scan per frame. chrome.tabs.sendMessage only ever hands back a
   single frame's reply, so forms living in an iframe (Stripe, Typeform, embedded
   Google Forms) would otherwise be invisible. executeScript with allFrames
   returns one result per frame, and it runs in the same isolated world as the
   content script, so it can call the function the content script exposed. */
export async function scanActiveTab(): Promise<{ fields: DetectedField[]; context: PageContext | null; tabId: number }> {
  const tab = await activeTab();
  const run = () =>
    chrome.scripting.executeScript({
      target: { tabId: tab.id!, allFrames: true },
      func: () => (globalThis as any).__formpilotScan?.() ?? null,
    });

  let results = await run().catch(() => []);

  // Pages that were already open when the extension was installed or reloaded
  // have no content script yet. Inject it, then ask again.
  if (!results.some((r) => r.result)) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id!, allFrames: true },
      files: ['content.js'],
    }).catch(() => {});
    results = await run().catch(() => []);
  }

  const fields: DetectedField[] = [];
  let context: PageContext | null = null;

  for (const entry of results) {
    const payload = entry.result as { fields: DetectedField[]; context: PageContext } | null;
    if (!payload) continue;
    // The top frame describes the page; sub-frames are only good for fields.
    if (entry.frameId === 0 || !context) context = payload.context;
    for (const field of payload.fields) {
      // Field ids are per-frame, so namespace them before they share a list.
      fields.push({ ...field, frameId: entry.frameId, id: `${entry.frameId}:${field.id}` });
    }
  }

  return { fields, context, tabId: tab.id! };
}

// Messages must be addressed to the frame the element actually lives in.
export async function fillField(tabId: number, field: DetectedField): Promise<boolean> {
  const response = await chrome.tabs.sendMessage(
    tabId,
    {
      type: 'FILL_FIELD',
      fieldId: field.fieldId,
      selector: field.selector,
      fallbackSelector: field.fallbackSelector,
      value: field.suggestedValue,
      tagName: field.tagName,
    },
    { frameId: field.frameId ?? 0 },
  ).catch(() => ({ success: false }));
  return Boolean(response?.success);
}

export function highlight(tabId: number, field: DetectedField, on: boolean) {
  // Address the element by the id stamped on it at scan time — a CSS path built
  // against the document never matches an element inside a shadow root.
  const selector = field.fieldId ? `[data-formpilot-id="${field.fieldId}"]` : field.selector;
  chrome.tabs.sendMessage(
    tabId,
    on ? { type: 'HIGHLIGHT_FIELDS', selectors: [selector] } : { type: 'CLEAR_HIGHLIGHTS' },
    { frameId: field.frameId ?? 0 },
  ).catch(() => {});
}

export function clearHighlights(tabId: number) {
  chrome.tabs.sendMessage(tabId, { type: 'CLEAR_HIGHLIGHTS' }).catch(() => {});
}
