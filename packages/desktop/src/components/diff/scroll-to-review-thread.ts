import {
  startVirtualizedTargetScroll,
  type CancelVirtualizedTargetScroll,
} from "./virtualized-target-scroll";

/**
 * Keep the selected review thread centered while the outer diff virtualizer
 * reconciles file heights. Threads taller than the viewport align to its top.
 */
export function scrollReviewThreadToCenter(
  container: HTMLElement,
  threadId: string,
): CancelVirtualizedTargetScroll {
  return startVirtualizedTargetScroll({
    container,
    selector: `[data-review-thread-id="${CSS.escape(threadId)}"]`,
    targetTop: (containerRect, threadRect) => {
      const viewportHeight = container.clientHeight || containerRect.height;
      const centeredOffset = Math.max(0, (viewportHeight - threadRect.height) / 2);
      return containerRect.top + centeredOffset;
    },
    missingTargetIsStable: false,
  });
}
