import type { DiffComment } from "@/api/generated";

/**
 * Helpers for deciding which pending diff-comments have been invalidated by
 * a file change since they were created.
 *
 * A comment is considered stale when its recorded `original_blob_sha`
 * differs from the file's current blob SHA. Per product rule, if *any*
 * pending comment on a given file is stale, *all* pending comments on that
 * file are invalidated together — a partial drop would leave surviving
 * comments pinned to potentially shifted line numbers.
 *
 * Legacy rows (created before the column existed) carry a `null`
 * `original_blob_sha` and are never auto-invalidated — fail-open so we
 * don't silently delete pre-migration data.
 */

/** Subset of {@link DiffComment} the helper actually reads. */
export type StaleCheckComment = Pick<
  DiffComment,
  "id" | "file_path" | "status" | "original_blob_sha"
>;

/**
 * Return the IDs of pending comments that should be deleted because their
 * file's blob SHA changed since the comment was created.
 *
 * Rules:
 * - Only `status === "pending"` comments are considered.
 * - Comments with no recorded sha (`null`/`undefined`) are skipped (legacy).
 * - If the file is missing from `currentBlobShas` entirely (deleted/renamed),
 *   all comments on that file are considered stale.
 * - If any comment on a file is stale, every pending comment on that file
 *   is returned — never a partial drop.
 */
export function findStalePendingCommentIds(
  comments: ReadonlyArray<StaleCheckComment>,
  currentBlobShas: Readonly<Record<string, string>>,
): number[] {
  const pendingByFile = new Map<string, StaleCheckComment[]>();
  for (const c of comments) {
    if (c.status !== "pending") continue;
    const list = pendingByFile.get(c.file_path) ?? [];
    list.push(c);
    pendingByFile.set(c.file_path, list);
  }

  const stale: number[] = [];
  for (const [filePath, fileComments] of pendingByFile) {
    const current = currentBlobShas[filePath];
    const anyMismatch = fileComments.some((c) => {
      if (!c.original_blob_sha) return false; // legacy: fail-open
      if (!current) return true; // file gone from blob-sha map
      return c.original_blob_sha !== current;
    });
    if (anyMismatch) {
      for (const c of fileComments) stale.push(c.id);
    }
  }
  return stale;
}
