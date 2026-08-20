/* ─────────────────────────────────────────────────
   FormPilot — Content Script
   Runs in every frame. Scans the DOM (including shadow roots) for anything
   fillable, injects values, and quietly reports what the user types so the
   extension keeps learning.
   ───────────────────────────────────────────────── */

import { inferCategory, isSensitiveField, SENSITIVE_VALUE } from '../shared/constants';
import type { PageContext } from '../shared/types';

// ─── Deep query (pierces open shadow roots) ───
// Design systems built on web components (Salesforce, Shopify, Ionic, many
// bank portals) put their inputs inside shadow DOM, where querySelectorAll on
// the document finds nothing at all.
function queryDeep(selector: string, root: Document | ShadowRoot = document): Element[] {
  const found: Element[] = Array.from(root.querySelectorAll(selector));
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow) found.push(...queryDeep(selector, shadow));
  }
  return found;
}

function findDeep(selector: string, root: Document | ShadowRoot = document): Element | null {
  return queryDeep(selector, root)[0] ?? null;
}

// ─── Unique selector generator ───
function generateSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const name = el.getAttribute('name');
  if (name) {
    const tag = el.tagName.toLowerCase();
    const escapedName = name.replace(/"/g, '\\"');
    try {
      const matches = document.querySelectorAll(`${tag}[name="${escapedName}"]`);
      if (matches.length === 1) return `${tag}[name="${escapedName}"]`;
    } catch(e) {}
  }

  // Build a path from the element to the root
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const tag = current.tagName.toLowerCase();
    const parentElement: HTMLElement | null = current.parentElement;
    if (parentElement) {
      const childrenArray = Array.from(parentElement.children) as Element[];
      const siblings = childrenArray.filter((c: Element) => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${idx})`);
      } else {
        parts.unshift(tag);
      }
    } else {
      parts.unshift(tag);
    }
    current = parentElement;
  }
  return `body > ${parts.join(' > ')}`;
}

// ─── Label extraction ───
function findLabel(el: Element): string {
  const root = el.getRootNode() as Document | ShadowRoot;

  // 1. Explicit <label for="id"> — resolved within the element's own root so
  //    shadow-DOM labels are found too.
  const id = el.id;
  if (id) {
    const label = root.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  // 2. Wrapped inside <label>
  const parentLabel = el.closest('label');
  if (parentLabel) {
    // Remove the input's own text from the label
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, textarea, select').forEach((c) => c.remove());
    if (clone.textContent?.trim()) return clone.textContent.trim();
  }

  // 3. aria-labelledby (W3C standard priority over aria-label)
  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const texts = ariaLabelledBy.split(/\s+/).map(refId => {
      const ref = (root as Document).getElementById?.(refId) ?? root.querySelector(`#${CSS.escape(refId)}`);
      return ref?.textContent?.trim() || '';
    }).filter(Boolean);
    if (texts.length > 0) return texts.join(' ');
  }

  // 4. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // 5. Placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return placeholder;

  // 6. Name attribute (humanized)
  const name = el.getAttribute('name');
  if (name) return name.replace(/[_\-\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

  // 7. Nearby text — look at previous sibling or parent text
  const prev = el.previousElementSibling;
  if (prev && ['SPAN', 'DIV', 'P', 'LABEL'].includes(prev.tagName)) {
    const text = prev.textContent?.trim();
    if (text && text.length < 80) return text;
  }

  // 8. Next sibling (common in custom UI checkboxes)
  const next = el.nextElementSibling;
  if (next && ['SPAN', 'DIV', 'P', 'LABEL'].includes(next.tagName)) {
    const text = next.textContent?.trim();
    if (text && text.length < 100) return text;
  }

  // 9. Parent text content exclusion as a fallback
  if (el.parentElement && el.parentElement.tagName !== 'BODY') {
    const parentText = el.parentElement.textContent?.trim();
    // If the parent has a reasonable amount of text, it might be the label
    if (parentText && parentText.length > 0 && parentText.length < 100) {
      return parentText;
    }
  }

  // 10. Data attributes commonly used by UI frameworks
  const dataValue = el.getAttribute('data-value');
  if (dataValue) return dataValue;

  return '';
}

// ─── Group Label extraction ───
function findGroupLabel(el: Element): string {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (parent.tagName === 'FIELDSET') {
      const legend = parent.querySelector('legend');
      if (legend?.textContent) return legend.textContent.trim();
    }
    const labelledby = parent.getAttribute('aria-labelledby');
    if (labelledby) {
      const labelEl = document.getElementById(labelledby);
      if (labelEl?.textContent) return labelEl.textContent.trim();
    }
    const roleAttr = parent.getAttribute('role');
    if (roleAttr === 'radiogroup' || roleAttr === 'group' || roleAttr === 'list') {
      const ariaLabel = parent.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();

      // Look for a heading inside or right before this group
      const heading = parent.querySelector('[role="heading"], h1, h2, h3, h4, h5, h6');
      if (heading?.textContent) return heading.textContent.trim();
    }

    // Google Forms typically has a [role="heading"] just before the list/group or in a close common ancestor
    const heading = parent.querySelector('[role="heading"]');
    if (heading?.textContent) {
       // Only accept it if this container is relatively small, meaning they are closely related
       if (parent.children.length < 15) {
          return heading.textContent.trim();
       }
    }
    parent = parent.parentElement;
  }
  return '';
}

// ─── Section heading a field sits under ───
// "Billing address" vs "Shipping address" is the difference between a right
// and a wrong answer, and it is never in the field's own label.
function findSection(el: Element): string {
  let node: Element | null = el;
  let hops = 0;
  while (node && node !== document.body && hops < 8) {
    const fieldset = node.tagName === 'FIELDSET' ? node : null;
    const legend = fieldset?.querySelector('legend')?.textContent?.trim();
    if (legend) return legend.slice(0, 80);

    let sibling = node.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName) || sibling.getAttribute('role') === 'heading') {
        const text = sibling.textContent?.trim();
        if (text && text.length < 80) return text;
      }
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
    hops++;
  }
  return '';
}

// ─── Visibility ───
function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el as HTMLElement);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

// Every element shape we know how to read or write.
const FIELD_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"])',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="spinbutton"]',
].join(', ');

// ─── Page context ───
function getPageContext(): PageContext {
  const text = (el: Element | null) => el?.textContent?.trim().replace(/\s+/g, ' ') ?? '';
  return {
    url: location.href,
    domain: location.hostname,
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute('content')?.slice(0, 300) ?? '',
    headings: Array.from(document.querySelectorAll('h1, h2, [role="heading"], legend'))
      .map(text)
      .filter((t) => t && t.length < 120)
      .slice(0, 10),
    submitLabels: Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], button'))
      .map((el) => text(el) || (el as HTMLInputElement).value || '')
      .filter((t) => t && t.length < 40)
      .slice(0, 6),
  };
}

// ─── Scan all form fields ───
function scanFields() {
  const elements = queryDeep(FIELD_SELECTOR);
  const fields: any[] = [];

  elements.forEach((el, index) => {
    const element = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    const typeAttr = element.getAttribute('type') || '';
    const roleAttr = element.getAttribute('role') || '';
    const isRadioOrCheckbox =
      typeAttr === 'radio' || typeAttr === 'checkbox' ||
      roleAttr === 'radio' || roleAttr === 'checkbox' || roleAttr === 'switch';
    const isEditable = element.hasAttribute('contenteditable');

    // A field we cannot write to is noise in the review list.
    if ((element as HTMLInputElement).disabled || (element as HTMLInputElement).readOnly) return;
    if (element.getAttribute('aria-disabled') === 'true') return;

    // Skip invisible elements, but allow hidden native radios/checkboxes commonly used by UI frameworks
    if (!isRadioOrCheckbox && !isVisible(element)) return;

    const tagName = isEditable && element.tagName !== 'TEXTAREA' && element.tagName !== 'INPUT'
      ? 'contenteditable'
      : element.tagName.toLowerCase();
    const type = isEditable ? 'textarea' : (element.type || roleAttr || tagName);
    let label = findLabel(element).replace(/^[_*.\-=\s]+|[_*.\-=\s]+$/g, '').trim();

    // Only group-map context for non-standalone components like checkboxes or radio buttons
    // UNLESS the field has a highly generic label (like "Your answer", "Hour", "Minute", "Day")
    // which signifies it's part of a composite or poorly-labeled group.
    const isGeneric = !label || ['your answer', 'hour', 'minute', 'am', 'pm', 'am/pm', 'time', 'date', 'month', 'year', 'day', 'choose'].includes(label.toLowerCase()) || label.length < 4;

    if (isRadioOrCheckbox || isGeneric) {
      let groupLabel = findGroupLabel(element).replace(/^[_*.\-=\s]+|[_*.\-=\s]+$/g, '').trim();
      if (groupLabel && groupLabel !== label && groupLabel.length > 0) {
        label = label ? `Question: ${groupLabel} | Option: ${label}` : `Question: ${groupLabel}`;
      }
    }

    const name = element.getAttribute('name') || '';
    const placeholder = element.getAttribute('placeholder') || '';
    const ariaLabel = element.getAttribute('aria-label') || '';
    const autocomplete = element.getAttribute('autocomplete') || '';
    const section = findSection(element);
    const required = element.hasAttribute('required') || element.getAttribute('aria-required') === 'true';

    // Extract options for select elements or ARIA listboxes
    let options: string[] | undefined;
    if (element.tagName === 'SELECT') {
      options = Array.from((element as HTMLSelectElement).options).map((o) => o.text);
    } else if (roleAttr === 'listbox' || roleAttr === 'combobox') {
      const listId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
      const list = listId ? document.getElementById(listId) : null;
      const opts = Array.from((list ?? element).querySelectorAll('[role="option"]'));
      if (opts.length > 0) options = opts.map(o => (o.textContent || '').trim()).filter(Boolean);
    } else if (element.getAttribute('list')) {
      // <input list="…"> backed by a <datalist>
      const dl = document.getElementById(element.getAttribute('list')!);
      const opts = Array.from(dl?.querySelectorAll('option') ?? []);
      if (opts.length > 0) options = opts.map(o => o.textContent || (o as HTMLOptionElement).value);
    }

    const fieldId = `ff-${index}-${Date.now()}`;
    element.setAttribute('data-formpilot-id', fieldId);

    const generatedSelector = generateSelector(element);
    const category = inferCategory(label, type, name, autocomplete);

    // Whatever is already typed into a password, card or OTP box stays on the
    // page. It is read only to decide the field is occupied — the value itself
    // never reaches the popup, the model, or storage.
    const rawValue = isEditable ? (element.textContent || '') : (element.value || '');
    const sensitive = isSensitiveField({ category, type, label, name, autocomplete });

    fields.push({
      id: `field-${index}-${Date.now()}`,
      fieldId,
      selector: generatedSelector,
      fallbackSelector: generatedSelector,
      tagName,
      type,
      label,
      placeholder,
      name,
      ariaLabel,
      autocomplete,
      section,
      required,
      currentValue: sensitive ? '' : rawValue,
      suggestedValue: '',
      confidence: 0,
      category,
      status: 'pending',
      options,
    });
  });

  return fields;
}

// Exposed on the isolated world so the popup can run one scan per frame via
// chrome.scripting.executeScript({ allFrames: true }) — chrome.tabs.sendMessage
// only ever delivers one frame's answer back.
(globalThis as any).__formpilotScan = () => ({ fields: scanFields(), context: getPageContext() });

// ─── Fill a single field ───
function fillField(fieldId: string | undefined, selector: string, fallbackSelector: string | undefined, value: string, tagName: string) {
  let element: HTMLElement | null = null;

  if (fieldId) {
    try { element = findDeep(`[data-formpilot-id="${fieldId}"]`) as HTMLElement | null; } catch(e) {}
  }
  if (!element) {
    try { element = findDeep(selector) as HTMLElement | null; } catch(e) {}
  }
  if (!element && fallbackSelector) {
    try { element = findDeep(fallbackSelector) as HTMLElement | null; } catch(e) {}
  }

  if (!element) {
    console.error('FormPilot: Element not found on page. DOM may have changed.');
    return false;
  }

  // Ensure element is focusable and interceptable
  try { element.focus(); } catch(e) {}

  if (tagName === 'select') {
    const select = element as HTMLSelectElement;
    // Try to match by value first, then by text
    const optionByValue = Array.from(select.options).find(
      (o) => o.value.toLowerCase() === value.toLowerCase()
    );
    // Exact text match first — "India" must not land on "Indiana".
    const optionByExactText = Array.from(select.options).find(
      (o) => o.text.trim().toLowerCase() === value.trim().toLowerCase()
    );
    const optionByText = Array.from(select.options).find(
      (o) => o.text.toLowerCase().includes(value.toLowerCase())
    );
    const match = optionByValue || optionByExactText || optionByText;
    if (!match) return false;
    select.value = match.value;
    select.dispatchEvent(new Event('focus', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('blur', { bubbles: true }));
  } else if (tagName === 'contenteditable') {
    // Rich-text editors (Notion-style, Quill, ProseMirror) read from the DOM,
    // not from .value, and listen for input events to sync their model.
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  } else if (tagName === 'textarea') {
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      (element as HTMLTextAreaElement).value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  } else if (
    (tagName === 'input' && ((element as HTMLInputElement).type === 'checkbox' || (element as HTMLInputElement).type === 'radio')) ||
    ['checkbox', 'radio', 'switch'].includes(element.getAttribute('role') || '')
  ) {
    let isChecked = ['true', 'yes', 'on', 'checked'].includes(value.toLowerCase());
    if (tagName === 'input') {
      const elInput = element as HTMLInputElement;
      if (elInput.value && value.toLowerCase() === elInput.value.toLowerCase()) {
         isChecked = true;
      }
      if (elInput.checked !== isChecked) {
        elInput.click();
      }
    } else {
      // ARIA role element
      const currentlyChecked = element.getAttribute('aria-checked') === 'true';
      if (currentlyChecked !== isChecked) {
        element.click();
      }
    }
  } else if (element.getAttribute('role') === 'listbox' || element.getAttribute('role') === 'combobox') {
    // Attempt to open the custom dropdown by clicking it
    element.click();

    // Custom dropdown options are often rendered dynamically at the end of the body when opened!
    setTimeout(() => {
      const options = queryDeep('[role="option"]') as HTMLElement[];
      // Find exact or closest match.
      const match = options.find(o => o.textContent && o.textContent.toLowerCase().includes(value.toLowerCase()));
      if (match) {
        match.click(); // Click the resolved option
      }
    }, 250); // Pause briefly to allow CSS/React to spawn the dropdown menu
  } else {
    element.dispatchEvent(new Event('focus', { bubbles: true }));
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      (element as HTMLInputElement).value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Visual feedback
  element.classList.add('formpilot-filled');
  setTimeout(() => element.classList.remove('formpilot-filled'), 2000);

  return true;
}

// ─── Highlight fields ───
function highlightFields(selectors: string[]) {
  selectors.forEach((sel) => {
    const el = findDeep(sel);
    if (el) {
      el.classList.add('formpilot-highlight');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

function clearHighlights() {
  queryDeep('.formpilot-highlight, .formpilot-filled, .formpilot-scanning').forEach((el) => {
    el.classList.remove('formpilot-highlight', 'formpilot-filled', 'formpilot-scanning');
  });
}

// ─── Learning: watch what the user types ───
// The extension only ever learns from a finished edit (change/blur), never
// keystroke by keystroke, and the background drops anything sensitive.
let lastLearned = '';
function observeInput(event: Event) {
  const el = event.target as HTMLInputElement | null;
  if (!el || !el.tagName) return;
  if (el.tagName === 'INPUT' && ['password', 'hidden', 'file'].includes(el.type)) return;

  const value = (el.isContentEditable ? el.textContent : el.value)?.trim() ?? '';
  if (!value || value.length > 400) return;

  const label = findLabel(el).replace(/^[_*.\-=\s]+|[_*.\-=\s]+$/g, '').trim();
  const name = el.getAttribute('name') || '';
  const type = el.type || el.tagName.toLowerCase();
  const autocomplete = el.getAttribute('autocomplete') || '';
  const category = inferCategory(label, type, name, autocomplete);

  // Judged here, before the value crosses the message port. The background
  // filters again, but a secret should never leave the frame it was typed in.
  if (isSensitiveField({ category, type, label, name, autocomplete })) return;
  if (SENSITIVE_VALUE.test(value)) return;

  const signature = `${label}|${name}|${value}`;
  if (signature === lastLearned) return;
  lastLearned = signature;

  chrome.runtime.sendMessage({
    type: 'OBSERVE_FIELD',
    field: { label, name, type, autocomplete, placeholder: el.getAttribute('placeholder') || '', category },
    value,
    domain: location.hostname,
  }).catch(() => {});
}

document.addEventListener('change', observeInput, true);
document.addEventListener('focusout', observeInput, true);

// ─── Live field count → toolbar badge ───
// Tells the user a page is fillable before they ever open the popup, and keeps
// up with forms that appear after load (SPAs, multi-step checkouts).
let countTimer: number | undefined;
function reportFieldCount() {
  clearTimeout(countTimer);
  countTimer = setTimeout(() => {
    // ponytail: light-DOM only. The badge is a hint, and a full shadow-piercing
    // walk every time a busy SPA mutates costs more than the hint is worth —
    // the real scan still goes deep. Switch to queryDeep if the count on
    // web-component-heavy sites ever misleads people.
    const count = Array.from(document.querySelectorAll(FIELD_SELECTOR)).filter(isVisible).length;
    chrome.runtime.sendMessage({ type: 'FIELD_COUNT', count }).catch(() => {});
  }, 600) as unknown as number;
}

if (window.top === window) {
  reportFieldCount();
  new MutationObserver(reportFieldCount).observe(document.documentElement, { childList: true, subtree: true });
}

// ─── Message listener ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security check: explicitly block external invocations
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  switch (message.type) {
    case 'SCAN_FIELDS': {
      sendResponse({ fields: scanFields(), context: getPageContext() });
      break;
    }
    case 'FILL_FIELD': {
      const success = fillField(message.fieldId, message.selector, message.fallbackSelector, message.value, message.tagName);
      sendResponse({ success });
      break;
    }
    case 'FILL_ALL': {
      const results = message.fields.map((f: any) => fillField(f.fieldId, f.selector, f.fallbackSelector, f.value, f.tagName));
      sendResponse({ success: results.every(Boolean), results });
      break;
    }
    case 'HIGHLIGHT_FIELDS': {
      highlightFields(message.selectors);
      sendResponse({ success: true });
      break;
    }
    case 'CLEAR_HIGHLIGHTS': {
      clearHighlights();
      sendResponse({ success: true });
      break;
    }
  }
  return false; // all responses are synchronous
});
