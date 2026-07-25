const MAX_FRAMES = 120;
const STABLE_FRAMES = 2;
const ALIGN_THRESHOLD_PX = 1;

export type CancelVirtualizedTargetScroll = () => void;

interface VirtualizedTargetScrollOptions {
  container: HTMLElement;
  selector: string;
  targetTop: (containerRect: DOMRect, targetRect: DOMRect, container: HTMLElement) => number;
  /** File wrappers may disappear permanently; annotations can mount later. */
  missingTargetIsStable: boolean;
}

const activeScrollByContainer = new WeakMap<HTMLElement, CancelVirtualizedTargetScroll>();

/**
 * Keeps one target aligned while a virtualizer replaces estimated geometry
 * with measured rows. A container owns at most one loop, while independent
 * diff viewers never cancel each other's navigation.
 */
export function startVirtualizedTargetScroll({
  container,
  selector,
  targetTop,
  missingTargetIsStable,
}: VirtualizedTargetScrollOptions): CancelVirtualizedTargetScroll {
  activeScrollByContainer.get(container)?.();

  let frame = 0;
  let frames = 0;
  let stableFrames = 0;
  const cancel = (): void => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (activeScrollByContainer.get(container) === cancel) {
      activeScrollByContainer.delete(container);
    }
  };
  const align = (): void => {
    const target = container.querySelector<HTMLElement>(selector);
    if (!target) {
      stableFrames = missingTargetIsStable ? stableFrames + 1 : 0;
    } else {
      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const delta = targetRect.top - targetTop(containerRect, targetRect, container);
      if (Math.abs(delta) > ALIGN_THRESHOLD_PX) {
        container.scrollTop += delta;
        stableFrames = 0;
      } else {
        stableFrames += 1;
      }
    }
    if (stableFrames < STABLE_FRAMES && frames++ < MAX_FRAMES) {
      frame = requestAnimationFrame(align);
    } else {
      cancel();
    }
  };

  activeScrollByContainer.set(container, cancel);
  frame = requestAnimationFrame(align);
  return cancel;
}
