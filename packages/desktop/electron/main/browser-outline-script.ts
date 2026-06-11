// Builds a compact, token-cheap accessibility-style outline of the page and
// registers a stable ref (e1, e2, …) for every listed element in
// window.__cadencrRefs, so agents can act on refs instead of brittle selectors.
// The registry lives on the page window and is wiped on navigation — exactly
// when refs should expire. Inputs are embedded via JSON.stringify.

import { HIGHLIGHT_DURATION_MS, highlightBoxJs } from "./browser-dom-script";

// In-page helpers (visibility test, "is this worth listing", label/role/state
// extraction). Kept as a string fragment so domOutlineScript stays small.
const OUTLINE_HELPERS = `
  const INTERACTIVE = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','OPTION','LABEL','SUMMARY','DETAILS','NAV','MAIN','HEADER','FOOTER','FORM']);
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const interesting = (el) => INTERACTIVE.has(el.tagName) || /^H[1-6]$/.test(el.tagName)
    || el.tagName === 'IMG' || el.hasAttribute('role') || el.hasAttribute('tabindex')
    || el.hasAttribute('aria-label') || typeof el.onclick === 'function';
  const label = (el) => {
    const raw = el.getAttribute('aria-label') || el.getAttribute('placeholder')
      || (el.tagName === 'IMG' ? (el.getAttribute('alt') || '') : '')
      || (el.tagName === 'INPUT' ? (el.value || '') : '')
      || (el.children.length ? '' : (el.textContent || ''));
    return raw.replace(/\\s+/g, ' ').trim().slice(0, 80);
  };
  const role = (el) => el.getAttribute('role') || el.tagName.toLowerCase();
  const state = (el) => {
    const out = [];
    if (el.id) out.push('#' + el.id);
    const type = el.getAttribute && el.getAttribute('type'); if (type) out.push('type=' + type);
    if (el.disabled) out.push('disabled');
    if (el.checked) out.push('checked');
    const href = el.getAttribute && el.getAttribute('href'); if (href) out.push('href=' + href.slice(0, 60));
    return out.length ? ' ' + out.join(' ') : '';
  };`;

export function domOutlineScript(selector: string | undefined, maxLength: number): string {
  return `(() => {
    const sel = ${JSON.stringify(selector ?? null)};
    const max = ${JSON.stringify(maxLength)};
    let root;
    try { root = sel ? document.querySelector(sel) : document.body; }
    catch (error) { return { found: false, error: String((error && error.message) || error) }; }
    if (!root) return { found: false, selector: sel };
    ${OUTLINE_HELPERS}
    const refs = new Map();
    window.__cadencrRefs = refs;
    const lines = [];
    // depth is outline depth (nesting of listed elements), not DOM depth:
    // non-interesting containers are traversed without indenting their children.
    const walk = (el, depth) => {
      if (!(el instanceof Element) || !visible(el)) return;
      let next = depth;
      if (interesting(el)) {
        const ref = 'e' + (refs.size + 1);
        refs.set(ref, el);
        const name = label(el);
        lines.push('  '.repeat(depth) + '[' + ref + '] ' + role(el) + (name ? ' "' + name + '"' : '') + state(el));
        next = depth + 1;
      }
      for (const child of el.children) walk(child, next);
    };
    walk(root, 0);
    if (sel) { root.scrollIntoView({ block: 'center', inline: 'center' }); ${highlightBoxJs("root.getBoundingClientRect()", HIGHLIGHT_DURATION_MS)}; }
    const outline = lines.join('\\n');
    const truncated = outline.length > max;
    return {
      found: true,
      selector: sel,
      url: document.location.href,
      title: document.title,
      length: outline.length,
      refCount: refs.size,
      truncated,
      outline: truncated ? outline.slice(0, max) : outline,
    };
  })()`;
}
