import type { AnnotationSide, DiffLineAnnotation, SelectedLineRange } from "@pierre/diffs";
import type { ReactNode } from "react";
import type { CommentThread } from "@/api/generated";
import type { PrThreadLine } from "@/lib/pr-review-threads";
import { CommentExtendLine, CommentWidgetLine, type DiffComment } from "./DiffCommentWidget";
import type { ActiveWidget, CommentCallbacks, CommentLineData } from "./diff-comment-decorations";
import { PrReviewThreadAnnotation } from "./PrReviewThreadAnnotation";

export type CommentSide = "old" | "new";

/**
 * Everything that renders under one diff row. Local drafts and the forge's
 * review threads share a slot deliberately: a line with both should read as one
 * conversation about that line, not two stacked widgets that happen to line up.
 */
export interface CommentAnnotationMetadata {
  comments: DiffComment[];
  remoteThreads: CommentThread[];
  activeReviewThreadId: string | null | undefined;
  selectedReviewThreadIds: ReadonlySet<string> | undefined;
  onReviewThreadSelectedChange: ((threadId: string, selected: boolean) => void) | undefined;
  isActive: boolean;
  callbacks: CommentCallbacks | undefined;
}

function fromAnnotationSide(side: AnnotationSide | undefined): CommentSide {
  return side === "deletions" ? "old" : "new";
}

export function getCommentTarget(range: SelectedLineRange): {
  lineNumber: number;
  side: CommentSide;
} {
  return {
    lineNumber: range.start,
    side: fromAnnotationSide(range.side ?? range.endSide),
  };
}

function toAnnotationSide(side: CommentSide | undefined): AnnotationSide {
  return side === "old" ? "deletions" : "additions";
}

function slotKey(side: CommentSide, lineNumber: number): string {
  return `${side}:${lineNumber}`;
}

interface BuildLineAnnotationsOptions {
  commentLines?: CommentLineData[];
  remoteThreadLines?: PrThreadLine[];
  activeWidget?: ActiveWidget | null;
  callbacks?: CommentCallbacks;
  activeReviewThreadId?: string | null;
  selectedReviewThreadIds?: ReadonlySet<string>;
  onReviewThreadSelectedChange?: (threadId: string, selected: boolean) => void;
}

export function buildLineAnnotations({
  commentLines,
  remoteThreadLines,
  activeWidget,
  callbacks,
  activeReviewThreadId,
  selectedReviewThreadIds,
  onReviewThreadSelectedChange,
}: BuildLineAnnotationsOptions): DiffLineAnnotation<CommentAnnotationMetadata>[] | undefined {
  const slots = new Map<string, DiffLineAnnotation<CommentAnnotationMetadata>>();

  const slotFor = (
    side: CommentSide,
    lineNumber: number,
  ): DiffLineAnnotation<CommentAnnotationMetadata> => {
    const key = slotKey(side, lineNumber);
    const existing = slots.get(key);
    if (existing) return existing;
    const created: DiffLineAnnotation<CommentAnnotationMetadata> = {
      side: toAnnotationSide(side),
      lineNumber,
      metadata: {
        comments: [],
        remoteThreads: [],
        activeReviewThreadId,
        selectedReviewThreadIds,
        onReviewThreadSelectedChange,
        isActive: false,
        callbacks,
      },
    };
    slots.set(key, created);
    return created;
  };

  for (const line of remoteThreadLines ?? []) {
    slotFor(line.side, line.lineNumber).metadata.remoteThreads.push(...line.threads);
  }

  if (callbacks) {
    for (const line of commentLines ?? []) {
      for (const comment of line.comments) {
        slotFor(comment.side, line.lineNumber).metadata.comments.push(comment);
      }
    }
    if (activeWidget) {
      // The form widget renders the line's existing drafts itself, so marking
      // the slot active is what keeps them from appearing twice.
      slotFor(activeWidget.side ?? "new", activeWidget.lineNumber).metadata.isActive = true;
    }
  }

  const annotations = [...slots.values()].filter(
    (annotation) =>
      annotation.metadata.isActive ||
      annotation.metadata.comments.length > 0 ||
      annotation.metadata.remoteThreads.length > 0,
  );
  return annotations.length > 0 ? annotations : undefined;
}

export function renderAnnotation(
  annotation: DiffLineAnnotation<CommentAnnotationMetadata>,
): ReactNode {
  const {
    callbacks,
    comments,
    remoteThreads,
    activeReviewThreadId,
    selectedReviewThreadIds,
    onReviewThreadSelectedChange,
    isActive,
  } = annotation.metadata;
  return (
    <>
      <PrReviewThreadAnnotation
        threads={remoteThreads}
        activeThreadId={activeReviewThreadId}
        selectedThreadIds={selectedReviewThreadIds}
        onThreadSelectedChange={onReviewThreadSelectedChange}
      />
      {callbacks && isActive && (
        <CommentWidgetLine
          comments={comments}
          onSubmit={(content) => callbacks.onSubmit(annotation.lineNumber, content)}
          onClose={callbacks.onClose}
          onEdit={callbacks.onEdit}
          onDelete={callbacks.onDelete}
        />
      )}
      {callbacks && !isActive && (
        <CommentExtendLine
          comments={comments}
          onEdit={callbacks.onEdit}
          onDelete={callbacks.onDelete}
        />
      )}
    </>
  );
}
