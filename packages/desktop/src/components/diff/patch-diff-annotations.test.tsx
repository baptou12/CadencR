import { describe, expect, it, vi } from "vitest";
import type { CommentThread } from "@/api/generated";
import type { PrThreadLine } from "@/lib/pr-review-threads";
import { buildLineAnnotations } from "./patch-diff-annotations";
import type { DiffComment } from "./DiffCommentWidget";
import type { CommentCallbacks, CommentLineData } from "./diff-comment-decorations";

const callbacks: CommentCallbacks = {
  onSubmit: vi.fn(),
  onClose: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

function draft(overrides: Partial<DiffComment> = {}): DiffComment {
  return {
    id: 1,
    feature_id: 1,
    file_path: "src/app.ts",
    line_number: 12,
    side: "new",
    content: "local draft",
    status: "pending",
    created_at: "2026-07-20 09:00:00",
    ...overrides,
  };
}

function remoteLine(overrides: Partial<PrThreadLine> = {}): PrThreadLine {
  const thread: CommentThread = {
    id: "remote-1",
    resolved: false,
    outdated: false,
    file: "src/app.ts",
    line: 12,
    side: "new",
    comments: [],
  };
  return { lineNumber: 12, side: "new", threads: [thread], ...overrides };
}

describe("buildLineAnnotations", () => {
  it("renders forge threads even when local commenting is unavailable", () => {
    // A read-only diff surface passes no callbacks; the review still has to show.
    const annotations = buildLineAnnotations({ remoteThreadLines: [remoteLine()] });

    expect(annotations).toHaveLength(1);
    expect(annotations?.[0].metadata.remoteThreads).toHaveLength(1);
    expect(annotations?.[0].side).toBe("additions");
  });

  it("carries shared review selection into the inline annotation", () => {
    const selectedIds = new Set(["remote-1"]);
    const onSelectedChange = vi.fn();

    const annotations = buildLineAnnotations({
      remoteThreadLines: [remoteLine()],
      selectedReviewThreadIds: selectedIds,
      onReviewThreadSelectedChange: onSelectedChange,
    });

    expect(annotations?.[0].metadata.selectedReviewThreadIds).toBe(selectedIds);
    expect(annotations?.[0].metadata.onReviewThreadSelectedChange).toBe(onSelectedChange);
  });

  it("merges a local draft and a forge thread on the same row into one slot", () => {
    const lines: CommentLineData[] = [{ lineNumber: 12, comments: [draft()] }];

    const annotations = buildLineAnnotations({
      commentLines: lines,
      remoteThreadLines: [remoteLine()],
      callbacks,
    });

    expect(annotations).toHaveLength(1);
    expect(annotations?.[0].metadata.comments).toHaveLength(1);
    expect(annotations?.[0].metadata.remoteThreads).toHaveLength(1);
  });

  it("keeps the two sides of one line in separate slots", () => {
    const lines: CommentLineData[] = [
      { lineNumber: 12, comments: [draft({ side: "old", id: 2 })] },
    ];

    const annotations = buildLineAnnotations({
      commentLines: lines,
      remoteThreadLines: [remoteLine()],
      callbacks,
    });

    expect(annotations).toHaveLength(2);
    expect(annotations?.map((annotation) => annotation.side).sort()).toEqual([
      "additions",
      "deletions",
    ]);
  });

  it("marks only the active side, so the other side's comments stay visible", () => {
    const lines: CommentLineData[] = [
      { lineNumber: 12, comments: [draft(), draft({ id: 2, side: "old" })] },
    ];

    const annotations = buildLineAnnotations({
      commentLines: lines,
      activeWidget: { lineNumber: 12, side: "new" },
      callbacks,
    });

    const additions = annotations?.find((annotation) => annotation.side === "additions");
    const deletions = annotations?.find((annotation) => annotation.side === "deletions");
    expect(additions?.metadata.isActive).toBe(true);
    expect(deletions?.metadata.isActive).toBe(false);
    expect(deletions?.metadata.comments).toHaveLength(1);
  });

  it("opens a form on a line that has nothing on it yet", () => {
    const annotations = buildLineAnnotations({
      activeWidget: { lineNumber: 5 },
      callbacks,
    });

    expect(annotations).toHaveLength(1);
    expect(annotations?.[0].metadata.isActive).toBe(true);
    expect(annotations?.[0].lineNumber).toBe(5);
  });

  it("returns undefined when there is nothing to draw", () => {
    expect(buildLineAnnotations({ callbacks })).toBeUndefined();
    expect(
      buildLineAnnotations({ commentLines: [], remoteThreadLines: [], callbacks }),
    ).toBeUndefined();
  });
});
