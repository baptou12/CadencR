import { useScopedGlobalShortcutById } from "@/hooks/useShortcut";

export interface GitTabShortcutTargets {
  enabled: boolean;
  toggleFileList: () => void;
  isFileListCollapseLoading: boolean;
  /** True on the PR view, which has no local drafts to send. */
  isPr: boolean;
  sendDrafts: () => void;
  sendReviewThreads: () => void;
  canSendReviewThreads: boolean;
  previousReview: () => void;
  nextReview: () => void;
  canNavigateReviews: boolean;
}

/**
 * The Git tab's scoped review and diff bindings.
 *
 * `diff-send-comments` is deliberately contextual rather than two separate
 * bindings: the active view already tells you which body of feedback "send" can
 * possibly mean, so one key keeps the muscle memory intact across views.
 */
export function useGitTabShortcuts({
  enabled,
  toggleFileList,
  isFileListCollapseLoading,
  isPr,
  sendDrafts,
  sendReviewThreads,
  canSendReviewThreads,
  previousReview,
  nextReview,
  canNavigateReviews,
}: GitTabShortcutTargets): void {
  useScopedGlobalShortcutById(
    "diff-toggle-sidebar",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      toggleFileList();
    },
    "git",
    { enabled: enabled && !isFileListCollapseLoading },
  );

  useScopedGlobalShortcutById(
    "diff-send-comments",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (isPr) sendReviewThreads();
      else sendDrafts();
    },
    "git",
    { enabled },
  );

  useScopedGlobalShortcutById(
    "diff-send-review-comments",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      sendReviewThreads();
    },
    "git",
    { enabled: enabled && canSendReviewThreads },
  );

  useScopedGlobalShortcutById(
    "git-previous-review-thread",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) previousReview();
    },
    "git",
    { enabled: enabled && canNavigateReviews },
  );

  useScopedGlobalShortcutById(
    "git-next-review-thread",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) nextReview();
    },
    "git",
    { enabled: enabled && canNavigateReviews },
  );
}
