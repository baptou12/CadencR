import { useEffect, type RefObject } from "react";

/** Scroll parents already replayed this frame: every list in one sidebar sees the same shift. */
const replayedThisFrame = new WeakSet<HTMLElement>();

function replayScroll(scrollParent: HTMLElement): void {
  if (replayedThisFrame.has(scrollParent)) return;
  replayedThisFrame.add(scrollParent);
  requestAnimationFrame(() => replayedThisFrame.delete(scrollParent));
  scrollParent.dispatchEvent(new Event("scroll"));
}

/**
 * Virtuoso with a `customScrollParent` re-reads the list's offset only on the
 * parent's scroll or resize and the list's own resize, so content above it
 * resizing leaves the rows it brings into view blank. Replays a `scroll` on
 * the parent when the list's offset in the scroll content (the Radix
 * viewport's single child) changes. Radix shows its scrollbar only when
 * `scrollTop` changes, so the synthetic event stays invisible.
 */
export function useScrollParentOffsetSync(
  listRef: RefObject<HTMLElement | null>,
  scrollParent: HTMLElement | null,
): void {
  useEffect(() => {
    const content = scrollParent?.firstElementChild;
    if (!scrollParent || !content) return;
    const measureOffset = (list: HTMLElement): number =>
      list.getBoundingClientRect().top -
      scrollParent.getBoundingClientRect().top +
      scrollParent.scrollTop;
    let lastOffset = listRef.current ? measureOffset(listRef.current) : undefined;
    const observer = new ResizeObserver(() => {
      const list = listRef.current;
      if (!list) return;
      const offset = measureOffset(list);
      if (offset === lastOffset) return;
      lastOffset = offset;
      replayScroll(scrollParent);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [listRef, scrollParent]);
}
