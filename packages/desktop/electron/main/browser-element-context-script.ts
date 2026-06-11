export function elementContextScript(): string {
  return `(() => new Promise((resolve) => {
    const previousCursor = document.documentElement.style.cursor;
    const marker = document.createElement('div');
    Object.assign(marker.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #bd93f9', background: 'rgba(189,147,249,.12)', transition: 'all 60ms ease' });
    document.documentElement.style.cursor = 'crosshair';
    document.body.appendChild(marker);
    let current = document.body;
    const describe = (el) => {
      const rect = el.getBoundingClientRect();
      const styles = getComputedStyle(el);
      const attrs = {};
      for (const a of el.attributes || []) attrs[a.name] = a.value;
      return { selectorCandidates: [el.id ? '#' + CSS.escape(el.id) : el.tagName.toLowerCase(), el.className ? el.tagName.toLowerCase() + '.' + String(el.className).trim().split(new RegExp('\\s+')).map(CSS.escape).join('.') : el.tagName.toLowerCase()], tagName: el.tagName.toLowerCase(), id: el.id || undefined, className: typeof el.className === 'string' ? el.className : undefined, textPreview: (el.textContent || '').trim().slice(0, 240), attributes: attrs, boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, computedStyles: { display: styles.display, position: styles.position, color: styles.color, backgroundColor: styles.backgroundColor, fontSize: styles.fontSize }, accessibility: { role: el.getAttribute('role') || undefined, name: el.getAttribute('aria-label') || undefined } };
    };
    const move = (event) => {
      const target = document.elementFromPoint(event.clientX, event.clientY);
      if (!(target instanceof Element) || target === marker) return;
      current = target;
      const rect = target.getBoundingClientRect();
      Object.assign(marker.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
    };
    const cleanup = () => { document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true); document.documentElement.style.cursor = previousCursor; marker.remove(); };
    const click = (event) => { event.preventDefault(); event.stopPropagation(); cleanup(); resolve(describe(current)); };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
  }))()`;
}
