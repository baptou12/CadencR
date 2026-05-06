/**
 * Shared keyboard navigation for the branch pickers (the prompt's
 * `WorktreeButtonGroup` Branch chip and the feature header's `BranchPicker`).
 *
 * Both render through `react-virtuoso`, so a regular `roving-tabindex`
 * pattern can't reach offscreen rows directly. Instead we keep an
 * `activeIndex` in state, drive `Virtuoso.scrollIntoView` to keep it
 * visible, and consume Up/Down/Enter from a single keydown handler that
 * the consumer wires onto the popover's search input.
 *
 * Returning the handler instead of binding to a ref keeps consumers in
 * control of which element captures the events (auto-focused input in
 * one case, the popover content in the other).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import type { VirtuosoHandle } from "react-virtuoso";

interface BranchListKeyboard {
  activeIndex: number;
  virtuosoRef: RefObject<VirtuosoHandle | null>;
  onKeyDown: (e: KeyboardEvent) => void;
}

export function useBranchListKeyboard<T>(
  items: T[],
  onPick: (item: T) => void,
): BranchListKeyboard {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset when the visible list shrinks (typed search narrowing it) so a
  // stale index doesn't point past the end.
  useEffect(() => {
    setActiveIndex((prev) => (prev >= items.length ? 0 : prev));
  }, [items.length]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = Math.min(prev + 1, items.length - 1);
          virtuosoRef.current?.scrollIntoView({ index: next });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          virtuosoRef.current?.scrollIntoView({ index: next });
          return next;
        });
      } else if (e.key === "Enter") {
        const item = items[activeIndex];
        if (!item) return;
        e.preventDefault();
        onPick(item);
      }
    },
    [activeIndex, items, onPick],
  );

  return { activeIndex, virtuosoRef, onKeyDown };
}
