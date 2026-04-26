/* ─────────────────────────────────────────────────
   FormPilot — Content Script
   Scans DOM for form fields, injects filled values.
   ───────────────────────────────────────────────── */

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
  // 1. Explicit <label for="id">
  const id = el.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
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
    const texts = ariaLabelledBy.split(/\s+/).map(id => {
      const ref = document.getElementById(id);
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

// ─── Category inference ───
function inferCategory(label: string, type: string, name: string): string {
  const combined = `${label} ${name} ${type}`.toLowerCase();

  if (/email/i.test(combined)) return 'contact';
  if (/phone|tel|mobile/i.test(combined)) return 'contact';
  if (/first\s?name|last\s?name|full\s?name|^name$/i.test(combined)) return 'personal';
  if (/address|street|apt|suite/i.test(combined)) return 'address';
  if (/city|state|province|zip|postal|country/i.test(combined)) return 'address';
  if (/linkedin|github|twitter|website|portfolio|url/i.test(combined)) return 'social';
  if (/company|organization|employer|role|title|position|job/i.test(combined)) return 'professional';
  if (/school|university|college|degree|gpa|education|major/i.test(combined)) return 'education';
  if (/project|describe|tell\s?us|why|essay|motivation|about|bio|summary|cover/i.test(combined)) return 'essay';
  if (/skill|technology|stack|experience/i.test(combined)) return 'professional';

  if (type === 'textarea') return 'essay';
  return 'other';
}

// ─── Scan all form fields ───
function scanFields() {
  const selector = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"])',
    ':not([type="reset"]):not([type="image"]):not([type="file"]):not([type="checkbox"])',
    ':not([type="radio"]),',
    'textarea,',
    'select',
  ].join('');

  // Cleaner selector
  const elements = document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="file"]), textarea, select, [role="radio"], [role="checkbox"], [role="listbox"], [role="combobox"]'
  );

  const fields: any[] = [];

  elements.forEach((el, index) => {
    const element = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

    const typeAttr = element.getAttribute('type') || '';
    const roleAttr = element.getAttribute('role') || '';
    const isRadioOrCheckbox = 
      typeAttr === 'radio' || typeAttr === 'checkbox' || 
      roleAttr === 'radio' || roleAttr === 'checkbox';

    // Skip invisible elements, but allow hidden native radios/checkboxes commonly used by UI frameworks
    if (!isRadioOrCheckbox) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (rect.width === 0 && rect.height === 0) return;
      if (style.display === 'none' || style.visibility === 'hidden') return;
    }

    const type = element.type || roleAttr || element.tagName.toLowerCase();
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

    // Extract options for select elements or ARIA listboxes
    let options: string[] | undefined;
    if (element.tagName === 'SELECT') {
      options = Array.from((element as HTMLSelectElement).options).map((o) => o.text);
    } else if (roleAttr === 'listbox' || roleAttr === 'combobox') {
      const opts = Array.from(element.querySelectorAll('[role="option"]'));
      if (opts.length > 0) {
        options = opts.map(o => o.textContent || '');
      } else {
        // Some frameworks append options dynamically, but we can look for siblings or data attributes if needed.
        // If empty, the AI will just guess based on standard dropdown values.
      }
    }

    const fieldId = `ff-${index}-${Date.now()}`;
    element.setAttribute('data-formpilot-id', fieldId);

    const generatedSelector = generateSelector(element);

    fields.push({
      id: `field-${index}-${Date.now()}`,
      fieldId,
      selector: generatedSelector,
      fallbackSelector: generatedSelector,
      tagName: element.tagName.toLowerCase(),
      type,
      label,
      placeholder,
      name,
      ariaLabel,
      currentValue: element.value || '',
      suggestedValue: '',
      confidence: 0,
      category: inferCategory(label, type, name),
      status: 'pending',
      options,
    });
  });

  return fields;
}

// ─── Fill a single field ───
function fillField(fieldId: string | undefined, selector: string, fallbackSelector: string | undefined, value: string, tagName: string) {
  let element: HTMLElement | null = null;
  
  if (fieldId) {
    try { element = document.querySelector(`[data-formpilot-id="${fieldId}"]`) as HTMLElement | null; } catch(e) {}
  }
  if (!element) {
    try { element = document.querySelector(selector) as HTMLElement | null; } catch(e) {}
  }
  if (!element && fallbackSelector) {
    try { element = document.querySelector(fallbackSelector) as HTMLElement | null; } catch(e) {}
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
    const optionByText = Array.from(select.options).find(
      (o) => o.text.toLowerCase().includes(value.toLowerCase())
    );
    const match = optionByValue || optionByText;
    if (match) {
      select.value = match.value;
      select.dispatchEvent(new Event('focus', { bubbles: true }));
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('blur', { bubbles: true }));
    }
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
    (element.getAttribute('role') === 'checkbox' || element.getAttribute('role') === 'radio')
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
      const options = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
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
    const el = document.querySelector(sel);
    if (el) el.classList.add('formpilot-highlight');
  });
}

function clearHighlights() {
  document.querySelectorAll('.formpilot-highlight, .formpilot-filled, .formpilot-scanning').forEach((el) => {
    el.classList.remove('formpilot-highlight', 'formpilot-filled', 'formpilot-scanning');
  });
}

// ─── Message listener ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security check: explicitly block external invocations
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  switch (message.type) {
    case 'SCAN_FIELDS': {
      const fields = scanFields();
      sendResponse({ fields });
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
    case 'PROCEED_TO_NEXT_PAGE': {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a.button')) as HTMLElement[];
      const nextBtn = buttons.find(b => {
          const text = (b.textContent || (b as HTMLInputElement).value || '').toLowerCase().trim();
          return text === 'next' || text === 'continue' || text.includes('next page');
      });
      if (nextBtn) {
          nextBtn.click();
          sendResponse({ success: true, clicked: true });
      } else {
          sendResponse({ success: true, clicked: false });
      }
      break;
    }
  }
  return false; // all responses are synchronous
});

// ─── Auto-scan on page load (for popup to detect) ───
// MutationObserver for SPA form detection
const observer = new MutationObserver(() => {
  // Notify popup that DOM changed (new fields may be available)
  try {
    chrome.runtime.sendMessage({ type: 'DOM_CHANGED' });
  } catch {
    // Popup may not be open
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
