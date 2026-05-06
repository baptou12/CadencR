export const FOCUS_UNIFIED_AGENTS_SEARCH_EVENT = "cadencr:focus-unified-agents-search";

let pendingUnifiedAgentsSearchFocus = false;

export function markUnifiedAgentsSearchFocusPending(): void {
  pendingUnifiedAgentsSearchFocus = true;
}

export function consumeUnifiedAgentsSearchFocusPending(): boolean {
  const pending = pendingUnifiedAgentsSearchFocus;
  pendingUnifiedAgentsSearchFocus = false;
  return pending;
}

export function requestUnifiedAgentsSearchFocus(): void {
  window.dispatchEvent(new CustomEvent(FOCUS_UNIFIED_AGENTS_SEARCH_EVENT));
  focusUnifiedAgentsSearchElement();
}

function focusUnifiedAgentsSearchElement(): void {
  const element = document.querySelector<HTMLElement>(
    '[role="textbox"][aria-label="Filter agents"]',
  );
  if (!element) return;
  element.focus();
  moveCaretToElementEnd(element);
}

function moveCaretToElementEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}
