import { COMMENT_ANCHOR_ATTR } from "./browser-comment-overlay-script";

// Arms the element picker. When `anchorId` is provided the clicked element is
// tagged with it (via COMMENT_ANCHOR_ATTR) so a numbered comment badge can later
// be pinned to it; the agent/MCP path passes null and skips tagging.
export function elementContextScript(anchorId: string | null): string {
  return `(() => new Promise((resolve) => {
    const anchorId = ${JSON.stringify(anchorId)};
    const previousCursor = document.documentElement.style.cursor;
    const marker = document.createElement('div');
    Object.assign(marker.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #bd93f9', background: 'rgba(189,147,249,.12)', transition: 'all 60ms ease' });
    document.documentElement.style.cursor = 'crosshair';
    document.body.appendChild(marker);
    let current = document.body;
    const TEXT_LIMIT = 2000;
    const collapse = (s) => String(s == null ? '' : s).replace(new RegExp('\\s+', 'g'), ' ').trim();
    // Gather visible text across the whole subtree, plus text that textContent
    // misses (input/textarea values, placeholders, image alt, aria-labels), in
    // reading order. Lets a high-level wrapper still surface the on-screen text.
    const gatherText = (root) => {
      const parts = [];
      let len = 0;
      const push = (raw) => { if (len >= TEXT_LIMIT) return; const t = collapse(raw); if (!t) return; parts.push(t); len += t.length + 1; };
      const own = (el) => {
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { push(el.value); push(el.placeholder); }
        else if (tag === 'IMG') push(el.alt);
        push(el.getAttribute('aria-label'));
      };
      const walk = (el) => {
        own(el);
        for (const child of el.childNodes) {
          if (len >= TEXT_LIMIT) break;
          if (child.nodeType === 3) push(child.nodeValue);
          else if (child instanceof Element) walk(child);
        }
      };
      walk(root);
      return parts.join(' ').slice(0, TEXT_LIMIT);
    };
    const describe = (el) => {
      const rect = el.getBoundingClientRect();
      const styles = getComputedStyle(el);
      const attrs = {};
      for (const a of el.attributes || []) attrs[a.name] = a.value;
      return { selectorCandidates: [el.id ? '#' + CSS.escape(el.id) : el.tagName.toLowerCase(), el.className ? el.tagName.toLowerCase() + '.' + String(el.className).trim().split(new RegExp('\\s+')).map(CSS.escape).join('.') : el.tagName.toLowerCase()], tagName: el.tagName.toLowerCase(), id: el.id || undefined, className: typeof el.className === 'string' ? el.className : undefined, textPreview: gatherText(el), attributes: attrs, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, computedStyles: { display: styles.display, position: styles.position, color: styles.color, backgroundColor: styles.backgroundColor, fontSize: styles.fontSize }, accessibility: { role: el.getAttribute('role') || undefined, name: el.getAttribute('aria-label') || undefined } };
    };
    const pick = (x, y) => {
      const stack = document.elementsFromPoint(x, y).filter((el) => el instanceof Element && el !== marker);
      // Prefer the first element under the cursor that is not a near-full-viewport
      // overlay (>85% of the viewport), so modal backdrops don't shadow the real target.
      const maxArea = window.innerWidth * window.innerHeight * 0.85;
      const focused = stack.find((el) => { const r = el.getBoundingClientRect(); return r.width * r.height < maxArea; });
      return focused || stack[0] || null;
    };
    const move = (event) => {
      const target = pick(event.clientX, event.clientY);
      if (!target) return;
      current = target;
      const rect = target.getBoundingClientRect();
      Object.assign(marker.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    };
    const cleanup = () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.documentElement.style.cursor = previousCursor; marker.remove(); };
    const click = (event) => { event.preventDefault(); event.stopPropagation(); cleanup(); if (anchorId) current.setAttribute(${JSON.stringify(COMMENT_ANCHOR_ATTR)}, anchorId); resolve(describe(current)); };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
  }))()`;
}
