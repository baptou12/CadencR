import { describe, it, expect } from "vitest";
import { findStalePendingCommentIds, type StaleCheckComment } from "./diff-comment-validity";

const c = (
  id: number,
  file_path: string,
  original_blob_sha: string | null = null,
  status: string = "pending",
): StaleCheckComment => ({ id, file_path, status, original_blob_sha });

describe("findStalePendingCommentIds", () => {
  it("returns empty when shas match", () => {
    const comments = [c(1, "a.ts", "sha_a"), c(2, "b.ts", "sha_b")];
    const shas = { "a.ts": "sha_a", "b.ts": "sha_b" };
    expect(findStalePendingCommentIds(comments, shas)).toEqual([]);
  });

  it("returns the comment id when its file's sha changed", () => {
    const comments = [c(1, "a.ts", "sha_old")];
    const shas = { "a.ts": "sha_new" };
    expect(findStalePendingCommentIds(comments, shas)).toEqual([1]);
  });

  it("invalidates ALL pending comments on a file when any are stale", () => {
    const comments = [
      c(1, "a.ts", "sha_old"),
      c(2, "a.ts", "sha_new"), // matches current
      c(3, "a.ts", "sha_old"),
    ];
    const shas = { "a.ts": "sha_new" };
    expect(findStalePendingCommentIds(comments, shas).sort()).toEqual([1, 2, 3]);
  });

  it("treats files missing from the blob-sha map as stale", () => {
    const comments = [c(1, "deleted.ts", "sha_old")];
    expect(findStalePendingCommentIds(comments, {})).toEqual([1]);
  });

  it("never invalidates legacy rows with null sha", () => {
    const comments = [c(1, "a.ts", null)];
    const shas = { "a.ts": "sha_new" };
    expect(findStalePendingCommentIds(comments, shas)).toEqual([]);
  });

  it("does not let a legacy row save its file-mates from invalidation", () => {
    // One stale row + one legacy row on the same file → file is invalidated,
    // both ids returned (per the all-or-nothing rule).
    const comments = [c(1, "a.ts", null), c(2, "a.ts", "sha_old")];
    const shas = { "a.ts": "sha_new" };
    expect(findStalePendingCommentIds(comments, shas).sort()).toEqual([1, 2]);
  });

  it("ignores non-pending comments", () => {
    const comments = [c(1, "a.ts", "sha_old", "sent"), c(2, "a.ts", "sha_old", "resolved")];
    const shas = { "a.ts": "sha_new" };
    expect(findStalePendingCommentIds(comments, shas)).toEqual([]);
  });

  it("treats files independently", () => {
    const comments = [
      c(1, "a.ts", "sha_old"), // stale
      c(2, "b.ts", "sha_b"), // fresh
      c(3, "c.ts", "sha_c"), // fresh
    ];
    const shas = { "a.ts": "sha_new", "b.ts": "sha_b", "c.ts": "sha_c" };
    expect(findStalePendingCommentIds(comments, shas)).toEqual([1]);
  });

  it("returns empty for an empty input", () => {
    expect(findStalePendingCommentIds([], {})).toEqual([]);
  });
});
