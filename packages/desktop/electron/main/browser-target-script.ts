// In-page scripts that resolve a {selector|ref} target to an element and act on
// it (measure, fill, wait). Refs come from window.__cadencrRefs, populated by
// the outline snapshot. Inputs are embedded via JSON.stringify so selectors and
// values are inert literals.

import { HIGHLIGHT_DURATION_MS, highlightBoxJs } from "./browser-dom-script";

export interface BrowserTarget {
  selector?: string;
  ref?: string;
}

// Resolves `el` from `t` (a {selector, ref} object) or sets a human `err`. A
// stale ref points the agent back at browser_get_snapshot.
const RESOLVE_EL = `
  let el = null, err = null;
  try {
    if (t.ref) {
      el = (window.__cadencrRefs && window.__cadencrRefs.get(t.ref)) || null;
      if (!el) err = 'Unknown or stale ref ' + t.ref + '. Refs reset on navigation and on each browser_get_snapshot — take a fresh snapshot.';
    } else if (t.selector) {
      el = document.querySelector(t.selector);
      if (!el) err = 'No element matched selector: ' + t.selector;
    } else {
      err = 'Provide a selector or ref.';
    }
  } catch (e) { err = String((e && e.message) || e); }
  if (el && !el.isConnected) { el = null; err = 'Element is detached from the page. Take a fresh browser_get_snapshot.'; }`;

function targetJson(target: BrowserTarget): string {
  return JSON.stringify({ selector: target.selector ?? null, ref: target.ref ?? null });
}

export function resolveTargetScript(target: BrowserTarget): string {
  return `(() => {
    const t = ${targetJson(target)};
    ${RESOLVE_EL}
    if (!el) return { found: false, error: err };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return {
      found: true,
      boundingBox: { x: r.x, y: r.y, width: r.width, height: r.height },
      center: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    };
  })()`;
}

export function fillTargetScript(target: BrowserTarget, value: string): string {
  return `(() => {
    const t = ${targetJson(target)};
    const value = ${JSON.stringify(value)};
    ${RESOLVE_EL}
    if (!el) return { found: false, error: err };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    if (typeof el.focus === 'function') el.focus();
    if (el.isContentEditable) {
      el.textContent = value;
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    ${highlightBoxJs("el.getBoundingClientRect()", HIGHLIGHT_DURATION_MS)};
    return { found: true, ok: true };
  })()`;
}

export function waitForScript(
  selector: string | undefined,
  text: string | undefined,
  timeoutMs: number,
): string {
  return `(() => new Promise((resolve) => {
    const sel = ${JSON.stringify(selector ?? null)};
    const text = ${JSON.stringify(text ?? null)};
    const timeout = ${JSON.stringify(timeoutMs)};
    const start = performance.now();
    const hit = () => {
      try { if (sel && document.querySelector(sel)) return true; } catch (e) { return false; }
      if (text && (document.body ? document.body.innerText : '').includes(text)) return true;
      return false;
    };
    const tick = () => {
      const elapsedMs = Math.round(performance.now() - start);
      if (hit()) { resolve({ found: true, elapsedMs }); return; }
      if (elapsedMs >= timeout) { resolve({ found: false, elapsedMs }); return; }
      setTimeout(tick, 100);
    };
    tick();
  }))()`;
}
