const EDITABLE_SHORTCUT_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='combobox']",
  ".cm-editor",
  ".monaco-editor",
  "[data-focus-zone='editor']",
].join(",");

/** Focus-target predicates shared by app-level shortcuts. */
export function isInCodeMirrorEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".cm-editor") !== null;
}

export function isInTerminalFocusZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-focus-zone="terminal"]') !== null;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(EDITABLE_SHORTCUT_SELECTOR) !== null;
}

export function isEditableShortcutElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(EDITABLE_SHORTCUT_SELECTOR);
}

export function getDeepestActiveElement(): Element | null {
  let active: Element | null = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export function hasActiveTextSelection(): boolean {
  const selection = document.getSelection();
  return selection != null && !selection.isCollapsed;
}
