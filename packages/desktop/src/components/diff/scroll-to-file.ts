import {
  startVirtualizedTargetScroll,
  type CancelVirtualizedTargetScroll,
} from "./virtualized-target-scroll";

/**
 * Scroll a diff file block to the top of the virtualized scroll container.
 *
 * The diff list renders files lazily and re-measures estimated heights after
 * navigation. Re-pinning for a few frames keeps the target exact while those
 * measurements settle.
 */
export function scrollFileToTop(
  container: HTMLElement,
  filePath: string,
): CancelVirtualizedTargetScroll {
  return startVirtualizedTargetScroll({
    container,
    selector: `[data-file="${CSS.escape(filePath)}"]`,
    targetTop: (containerRect) => containerRect.top,
    missingTargetIsStable: true,
  });
}
