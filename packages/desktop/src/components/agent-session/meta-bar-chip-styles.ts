export const META_BAR_CHIP =
  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors";

export const AUTO_SCROLL_ACTIVE_CHIP =
  "bg-[var(--acc-green)]/15 text-[var(--acc-green)] hover:bg-[var(--acc-green)]/25";

export const WORKTREE_ACTIVE_CHIP =
  "bg-[var(--chip-worktree-bg)] text-[var(--chip-worktree-fg)] hover:bg-[var(--chip-worktree-bg-hover)]";

export const REVIEW_CHANGES_CHIP =
  "bg-[var(--acc-orange)]/15 text-[var(--acc-orange)] hover:bg-[var(--acc-orange)]/25";

// Segmented worktree chip (Branch picker + Mode picker). Mirrors `MODEL_GROUP`
// / `MODEL_SEGMENT` so the halves render as a single chip with a hairline
// divider — same height, same border, no gap. Shared by the branch picker and
// the mode picker so the two segments stay visually identical.
export const WORKTREE_GROUP =
  "inline-flex h-8 items-stretch rounded-md border border-border bg-muted/40 text-[11px] font-medium shadow-sm overflow-hidden";
export const WORKTREE_SEGMENT =
  "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors text-foreground hover:bg-accent";
export const WORKTREE_SEGMENT_ACTIVE =
  "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors bg-[var(--chip-worktree-bg)] text-[var(--chip-worktree-fg)] hover:bg-[var(--chip-worktree-bg-hover)]";
