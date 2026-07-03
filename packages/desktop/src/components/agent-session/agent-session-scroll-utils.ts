import type { FollowOutputCallback, VirtuosoHandle } from "react-virtuoso";

export type ScrollRef = (el: HTMLElement | null) => void;

export const HISTORY_SCROLL_TOP_PX = 160;
export const SCROLLBAR_HIT_TARGET_PX = 20;
// The initial agent-state window is intentionally small (see
// `AGENT_STATE_INITIAL_MESSAGE_LIMIT`) so latest-message + status paint
// instantly. If that window doesn't fill the viewport there's no scrollbar, so
// the user can't scroll up to reach older history. This caps how many pages we
// auto-prepend to produce a scrollbar before giving up (a pathological run of
// tiny collapsed rows).
export const MAX_VIEWPORT_FILL_PAGES = 6;

export function canScroll(el: HTMLElement): boolean {
  return el.scrollHeight > el.clientHeight;
}

export function isVerticalScrollbarPointer(el: HTMLElement, e: PointerEvent): boolean {
  const rect = el.getBoundingClientRect();
  return e.clientX >= rect.right - SCROLLBAR_HIT_TARGET_PX && e.clientX <= rect.right + 1;
}

export interface HistoryAnchor {
  scrollTop: number;
  scrollHeight: number;
}

export interface UseAgentSessionScrollResult {
  virtuosoRef: React.RefObject<VirtuosoHandle | null>;
  scrollContainerRef: ScrollRef;
  onStartReached: () => void;
  followOutput: FollowOutputCallback;
  onAtBottomStateChange: (atBottom: boolean) => void;
  onTotalListHeightChanged: (height: number) => void;
  autoScrollEnabled: boolean;
  isLoadingOlder: boolean;
  scrollToBottom: () => void;
}
