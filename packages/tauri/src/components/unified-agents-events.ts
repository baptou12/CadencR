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
}
