// DesignNote — best-effort unique CSS selector generator with structural fingerprint fallback.
// Prefers stable attributes (id, data-*, aria-label, semantic classes) and falls back to nth-child paths.
// Fingerprint: { tag, textHash, siblingIndex, parentFingerprint } for fuzzy re-matching.
// Anchor: human/agent-readable description (text, label, heading, landmark) — survives any DOM change.

(function () {
  function cssEscape(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, function (ch) {
      return '\\' + ch;
    });
  }

  function isUnique(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  // Ids/classes that frameworks and CSS-in-JS generate per build or render: they change on
  // reload, so a selector built on them breaks. (`:r3:`, radix-12, mui-45, css-1x2y, Btn_x7f3a…)
  function isGenerated(name) {
    return /^:|^(radix|mui|headlessui|react-aria|rc-|ember|ext-gen|yui|__)/i.test(name) ||
      /^(css|sc|jsx|emotion|svelte|tw|chakra)-/i.test(name) ||
      /\d{3,}/.test(name) ||
      /(^|[_-])(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{5,}$/i.test(name);
  }

  const STABLE_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa', 'data-id', 'data-component',
    'name', 'aria-label', 'placeholder', 'alt', 'title', 'for'];

  function attrSelector(el) {
    const doc = el.ownerDocument;
    const tag = el.tagName.toLowerCase();
    if (el.id && !isGenerated(el.id)) {
      const sel = '#' + cssEscape(el.id);
      if (isUnique(sel, doc)) return sel;
    }
    const attrs = tag === 'a' ? STABLE_ATTRS.concat('href') : STABLE_ATTRS;
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (!val || val.length > 120 || (attr === 'data-id' && isGenerated(val))) continue;
      const sel = `${tag}[${attr}="${cssEscape(val)}"]`;
      if (isUnique(sel, doc)) return sel;
    }
    for (const cls of Array.from(el.classList || [])) {
      if (!/^[A-Za-z][\w-]*$/.test(cls) || isGenerated(cls)) continue;
      const sel = `${tag}.${cls}`;
      if (isUnique(sel, doc)) return sel;
    }
    return null;
  }

  function nthChildSegment(el) {
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === el.tagName
    );
    if (siblings.length === 1) return tag;
    const index = Array.from(parent.children).indexOf(el) + 1;
    return `${tag}:nth-child(${index})`;
  }

  // Simple hash for text content
  function hashText(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h.toString(36);
  }

  function textHashOf(el) {
    const text = (el.textContent || '').trim().slice(0, 60);
    return text ? hashText(text) : '';
  }

  // Generate structural fingerprint for an element
  function getFingerprint(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    const textHash = textHashOf(el);
    const parent = el.parentElement;
    let siblingIndex = 0;
    if (parent) {
      const siblings = Array.from(parent.children);
      siblingIndex = siblings.indexOf(el);
    }
    const parentFingerprint = parent ? getFingerprint(parent) : null;
    return { tag, textHash, siblingIndex, parent: parentFingerprint };
  }

  // Find element by fingerprint (fuzzy match). Clues: same text (3), same position among
  // siblings (2), parent matches (3). Two clues agreeing (5+) is a match; one strong clue (3)
  // only when no other element has it too — three "Delete" buttons must not resolve to the first.
  function findByFingerprint(fp, doc) {
    if (!fp) return null;
    const candidates = doc.querySelectorAll(fp.tag);
    let bestMatch = null;
    let bestScore = -1;
    let ties = 0;
    // Resolve the parent once, not per candidate: it doesn't depend on the candidate, and
    // re-resolving it inside the loop made the cost exponential in ancestor depth (froze tabs).
    const parentMatch = fp.parent ? findByFingerprint(fp.parent, doc) : null;

    for (const el of candidates) {
      let score = 0;
      // Match text hash (textContent walks the whole subtree, so only read it when it can score)
      if (fp.textHash && textHashOf(el) === fp.textHash) score += 3;
      // Match sibling index: O(1) lookup instead of copying + scanning the sibling list
      const parent = el.parentElement;
      if (parent && parent.children[fp.siblingIndex] === el) score += 2;
      // Recursively match parent fingerprint
      if (parentMatch && parentMatch === parent) score += 3;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = el;
        ties = 0;
      } else if (score === bestScore) {
        ties++;
      }
    }
    if (ties) return null;
    return bestScore >= 3 ? bestMatch : null;
  }

  function buildPath(el) {
    const direct = attrSelector(el);
    if (direct) return direct;

    const path = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      const direct2 = attrSelector(node);
      if (direct2) {
        path.unshift(direct2);
        break;
      }
      path.unshift(nthChildSegment(node));
      node = node.parentElement;
      depth++;
    }
    return path.join(' > ');
  }

  function getSelector(el) {
    if (!el || el === document.documentElement) return 'html';
    try {
      const selector = buildPath(el);
      return selector || null;
    } catch (e) {
      return null;
    }
  }

  function cleanText(s, max) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // What a person (or a coding agent searching the source) would call this element:
  // `button "Pay now" in form "Payment" under "Checkout"`. Page JS expandos (React fibers)
  // aren't visible from the content script's isolated world, so component names come only
  // from data-component / data-testid attributes.
  function getAnchor(el) {
    if (!el || el.nodeType !== 1) return null;
    try {
      const attr = (n) => el.getAttribute(n) || '';
      const tag = el.tagName.toLowerCase();
      const label = cleanText(attr('aria-label') || attr('alt') || attr('title') || attr('placeholder') ||
        (el.labels && el.labels[0] ? el.labels[0].textContent : ''), 80);
      const text = cleanText(el.innerText != null ? el.innerText : el.textContent, 120);
      const role = attr('role');
      const testId = attr('data-testid') || attr('data-test') || attr('data-cy') || attr('data-qa');
      const compEl = el.closest('[data-component]');
      const component = compEl ? compEl.getAttribute('data-component') : '';
      const classes = Array.from(el.classList || []).filter((c) => !isGenerated(c)).slice(0, 4);

      let landmark = '';
      const lm = el.parentElement && el.parentElement.closest(
        'header,nav,main,footer,aside,form,dialog,[role="dialog"],[role="navigation"],[role="banner"],[role="main"],[role="contentinfo"],section[aria-label]');
      if (lm) {
        const lmName = cleanText(lm.getAttribute('aria-label') || lm.getAttribute('name') || (isGenerated(lm.id || '0000') ? '' : lm.id), 40);
        landmark = (lm.getAttribute('role') || lm.tagName.toLowerCase()) + (lmName ? ` "${lmName}"` : '');
      }

      // Nearest heading before the element in document order — usually its section title.
      let heading = '';
      for (const h of el.ownerDocument.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
        if (h === el || h.contains(el)) continue;
        if (h.compareDocumentPosition(el) & 4) heading = cleanText(h.textContent, 80); // 4 = FOLLOWING
        else break;
      }

      const name = label || text;
      let describe = (role || tag) + (name ? ` "${cleanText(name, 60)}"` : '');
      if (landmark) describe += ` in ${landmark}`;
      if (heading && heading !== name) describe += ` under "${heading}"`;
      return { tag, text, label, role, testId, component, classes, landmark, heading, describe };
    } catch (e) {
      return null;
    }
  }

  // Public API: get selector + fingerprint + anchor for storage
  function getSelectorWithFingerprint(el) {
    return {
      selector: getSelector(el),
      fingerprint: getFingerprint(el),
      anchor: getAnchor(el)
    };
  }

  // A nth-child path (`a > b:nth-child(3)`) still matches *something* after the page changes —
  // often a different element. Only trust such a hit when it still looks like what was saved.
  function looksLikeSaved(el, fp) {
    return el.tagName.toLowerCase() === fp.tag && (!fp.textHash || textHashOf(el) === fp.textHash);
  }

  // Public API: find element by selector, then fingerprint fallback. method 'none' = lost.
  function findElement(selector, fingerprint, doc) {
    const d = doc || document;
    // 1. Try exact selector (attribute-anchored ones are trusted; paths are verified)
    if (selector) {
      let el = null;
      try { el = d.querySelector(selector); } catch (e) { /* ignore invalid selector */ }
      if (el && (!fingerprint || !selector.includes(' > ') || looksLikeSaved(el, fingerprint))) {
        return { element: el, method: 'selector' };
      }
    }
    // 2. Try fingerprint fallback
    if (fingerprint) {
      const el = findByFingerprint(fingerprint, d);
      if (el) return { element: el, method: 'fingerprint' };
    }
    return { element: null, method: 'none' };
  }

  window.__designNoteGetSelector = getSelector;
  window.__designNoteGetSelectorWithFingerprint = getSelectorWithFingerprint;
  window.__designNoteFindElement = findElement;
  window.__designNoteIsGenerated = isGenerated;
})();
