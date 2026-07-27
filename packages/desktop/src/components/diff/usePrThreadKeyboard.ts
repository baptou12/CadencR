import { useEffect, useMemo, useRef, useState } from "react";
import type { CommentThread } from "@/api/generated";
import type { GitNavigationAdapter, GitNavigationAdapterRegistrar } from "./gitNavigation";

export interface PrThreadKeyboardParams {
  /** Threads in display order, i.e. after the filter. */
  threads: CommentThread[];
  register: GitNavigationAdapterRegistrar | undefined;
  onViewThread?: (thread: CommentThread) => void;
  onSelectedChange?: (threadId: string, selected: boolean) => void;
  selectedThreadIds?: ReadonlySet<string>;
  /** Scrolls the list body, so `d`/`u` behave as they do in every other Git view. */
  scrollHalfPage: (direction: -1 | 1) => boolean;
  /** Brings a thread the virtualizer has not rendered into the window. */
  revealThread: (index: number) => void;
}

export interface PrThreadKeyboard {
  focusedThreadId: string | null;
}

/**
 * Gives the proposal's thread list the same j/k/l/h/d/u vocabulary every other
 * Git sub-view already has, plus `x` to pick the focused thread.
 *
 * That last key is what closes the loop: read a review with j/k, pick the ones
 * worth acting on with `x`, hand them over with the send chord — without the
 * pointer, and without the checkbox column ever being the only way in.
 */
export function usePrThreadKeyboard({
  threads,
  register,
  onViewThread,
  onSelectedChange,
  selectedThreadIds,
  scrollHalfPage,
  revealThread,
}: PrThreadKeyboardParams): PrThreadKeyboard {
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);

  // A thread that filtering or a refetch removed can't stay focused. Derived
  // during render rather than pruned in an effect: it is a pure function of
  // `threads` and the focused id, so an effect only bought a second commit
  // every time the filter moved.
  const focused =
    focusedThreadId != null && threads.some((thread) => thread.id === focusedThreadId)
      ? focusedThreadId
      : null;

  // Everything the adapter closes over changes on most renders, so it reads
  // from a ref instead: re-registering on every keystroke would churn the
  // controller's slot, and the adapter identity is its own unregister token.
  // Written after commit rather than during render — the adapter only ever
  // runs from a keydown, so it never needs a value the DOM does not have yet.
  const latest = useRef<
    Omit<PrThreadKeyboardParams, "register"> & { focusedThreadId: string | null }
  >({
    threads,
    focusedThreadId,
    onViewThread,
    onSelectedChange,
    selectedThreadIds,
    scrollHalfPage,
    revealThread,
  });
  useEffect(() => {
    latest.current = {
      threads,
      focusedThreadId: focused,
      onViewThread,
      onSelectedChange,
      selectedThreadIds,
      scrollHalfPage,
      revealThread,
    };
  });

  const adapter = useMemo<GitNavigationAdapter>(
    () => ({
      getActiveItem: () => latest.current.focusedThreadId,
      moveSelection: (offset) => {
        const list = latest.current.threads;
        if (list.length === 0) return false;
        const index = list.findIndex((thread) => thread.id === latest.current.focusedThreadId);
        // From nowhere, `j` starts at the top and `k` at the bottom, so the
        // first keypress always lands on a thread you can see.
        const start = index < 0 ? (offset === 1 ? -1 : 0) : index;
        const next = (start + offset + list.length) % list.length;
        const thread = list[next];
        if (!thread) return false;
        setFocusedThreadId(thread.id);
        // Always the list, never a DOM probe: `revealThread` scrolls a row the
        // virtualizer has not rendered *and* leaves an already-visible one
        // alone, so wrapping from the last thread back to the first lands
        // correctly without a second mechanism racing it.
        latest.current.revealThread(next);
        return true;
      },
      open: () => {
        const { threads: list, focusedThreadId: id, onViewThread: view } = latest.current;
        const thread = list.find((candidate) => candidate.id === id);
        if (!thread || !view) return false;
        view(thread);
        return true;
      },
      back: () => {
        if (latest.current.focusedThreadId == null) return false;
        setFocusedThreadId(null);
        return true;
      },
      togglePicked: () => {
        const { focusedThreadId: id, onSelectedChange: change, selectedThreadIds } = latest.current;
        if (!id || !change) return false;
        change(id, !(selectedThreadIds?.has(id) ?? false));
        return true;
      },
      scrollHalfPage: (direction) => latest.current.scrollHalfPage(direction),
    }),
    [],
  );

  useEffect(() => register?.(adapter), [adapter, register]);

  return { focusedThreadId: focused };
}
