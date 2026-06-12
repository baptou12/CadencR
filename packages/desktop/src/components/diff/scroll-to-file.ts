/** Max frames to keep re-pinning before giving up (~200ms at 60fps). */
const MAX_FRAMES = 12;
/** Consecutive already-aligned (or missing) frames that count as "settled". */
const STABLE_FRAMES = 2;
/** Treat the file as pinned once it's within this many px of the top. */
const ALIGN_THRESHOLD_PX = 1;

/** The single in-flight scroll, so a new call supersedes the previous one. */
let pendingRaf = 0;

/**
 * Scroll a diff file block to the top of the virtualized scroll container.
 *
 * The diff list is windowed by `@pierre/diffs`, which renders files lazily and
 * re-measures their (initially estimated) heights as they enter the viewport.
 * A one-shot `scrollIntoView({ behavior: "smooth" })` lands in the wrong place
 * because the virtualizer's own scroll anchoring fires `scrollTo({ behavior:
 * "instant" })` mid-animation — cancelling the smooth scroll — and the target's
 * real offset isn't known until it renders. Instead we re-pin the file to the
 * container top across a few frames, correcting the scroll position until the
 * virtualizer settles (or we hit the frame cap).
 */
export function scrollFileToTop(container: HTMLElement, filePath: string): void {
  // Supersede any in-flight scroll so rapid clicks / held keyboard nav don't
  // spawn competing loops that fight over scrollTop.
  if (pendingRaf) cancelAnimationFrame(pendingRaf);

  const selector = `[data-file="${CSS.escape(filePath)}"]`;
  let frames = 0;
  let stable = 0;
  const align = (): void => {
    const el = container.querySelector<HTMLElement>(selector);
    if (!el) {
      // The wrapper is normally always mounted; bail if it's genuinely gone.
      stable += 1;
    } else {
      const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top;
      if (Math.abs(delta) > ALIGN_THRESHOLD_PX) {
        container.scrollTop += delta;
        stable = 0;
      } else {
        stable += 1;
      }
    }
    if (stable < STABLE_FRAMES && frames++ < MAX_FRAMES) pendingRaf = requestAnimationFrame(align);
  };
  pendingRaf = requestAnimationFrame(align);
}
