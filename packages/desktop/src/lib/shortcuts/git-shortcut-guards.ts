import {
  getDeepestActiveElement,
  hasActiveTextSelection,
  isEditableShortcutElement,
  isEditableShortcutTarget,
} from "./dom-targets";

const OPEN_OVERLAY_SELECTOR = [
  "[data-slot='dialog-content'][data-state='open']",
  "[data-slot='popover-content'][data-state='open']",
  "[data-slot='dropdown-menu-content'][data-state='open']",
  "[data-slot='dropdown-menu-sub-content'][data-state='open']",
  "[data-slot='context-menu-content'][data-state='open']",
  "[data-slot='context-menu-sub-content'][data-state='open']",
  "[data-slot='select-content'][data-state='open']",
  "[role='dialog'][data-state='open']",
  "[role='menu'][data-state='open']",
  "[role='listbox'][data-state='open']",
  "[role='dialog']:not([data-state]):not([aria-hidden='true'])",
  "[role='menu']:not([data-state]):not([aria-hidden='true'])",
  "[role='listbox']:not([data-state]):not([aria-hidden='true'])",
].join(",");

function composedPathOwnsTextInput(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => isEditableShortcutElement(target));
}

function hasOpenOverlay(): boolean {
  return document.querySelector(OPEN_OVERLAY_SELECTOR) != null;
}

/** True when the active surface, composition session, or overlay owns the key. */
export function shouldIgnoreGitShortcut(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.key === "Process" ||
    event.keyCode === 229
  ) {
    return true;
  }
  if (composedPathOwnsTextInput(event) || isEditableShortcutTarget(getDeepestActiveElement())) {
    return true;
  }
  return hasActiveTextSelection() || hasOpenOverlay();
}
