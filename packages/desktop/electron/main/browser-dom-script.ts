// In-page scripts injected via WebContents.executeJavaScript for DOM inspection.
// Inputs are embedded with JSON.stringify so selectors/limits are inert literals.

import type { BrowserBounds } from "./browser-types";

// How long the live highlight stays on screen before fading out (ms).
export const HIGHLIGHT_DURATION_MS = 900;

// Draws a self-removing highlight box at the given viewport-rect expression so
// the area an agent snapshots/screenshots/acts on is shown live in the browser.
// Matches the element-picker marker (see browser-element-context-script.ts).
// Shared by the snapshot, screenshot, fill, click and hover paths.
export function highlightBoxJs(rectExpr: string, durationMs: number): string {
  return `(() => {
    const r = ${rectExpr};
    if (!r || !(r.width || r.height)) return;
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'fixed', left: r.x + 'px', top: r.y + 'px',
      width: r.width + 'px', height: r.height + 'px',
      border: '2px solid #bd93f9', background: 'rgba(189,147,249,.18)',
      borderRadius: '2px', zIndex: '2147483647', pointerEvents: 'none',
      transition: 'opacity 220ms ease', opacity: '1',
    });
    document.documentElement.appendChild(box);
    setTimeout(() => { box.style.opacity = '0'; }, ${durationMs - 220});
    setTimeout(() => { box.remove(); }, ${durationMs});
  })()`;
}

export function flashHighlightScript(bounds: BrowserBounds): string {
  return highlightBoxJs(JSON.stringify(bounds), HIGHLIGHT_DURATION_MS);
}

export function domSnapshotScript(selector: string | undefined, maxLength: number): string {
  return `(() => {
    const sel = ${JSON.stringify(selector ?? null)};
    const max = ${JSON.stringify(maxLength)};
    let root;
    try {
      root = sel ? document.querySelector(sel) : document.documentElement;
    } catch (error) {
      return { found: false, error: String((error && error.message) || error) };
    }
    if (!root) return { found: false };
    if (sel) {
      root.scrollIntoView({ block: 'center', inline: 'center' });
      ${highlightBoxJs("root.getBoundingClientRect()", HIGHLIGHT_DURATION_MS)};
    }
    const html = root.outerHTML || '';
    const truncated = html.length > max;
    return {
      found: true,
      selector: sel,
      url: document.location.href,
      title: document.title,
      length: html.length,
      truncated,
      html: truncated ? html.slice(0, max) : html,
    };
  })()`;
}
