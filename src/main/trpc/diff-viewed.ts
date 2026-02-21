import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";

interface DiffViewedFileRow {
  id: number;
  feature_id: number;
  file_path: string;
  blob_sha: string;
  viewed_at: string;
}

export const diffViewedRouter = router({
  /** List all viewed files for a feature */
  list: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const rows = db
        .prepare(
          "SELECT id, feature_id, file_path, blob_sha, viewed_at FROM diff_viewed_files WHERE feature_id = ? ORDER BY file_path ASC",
        )
        .all(input.featureId) as DiffViewedFileRow[];
      return rows;
    }),

  /** Mark a file as viewed (upsert with blob SHA) */
  markViewed: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        filePath: z.string(),
        blobSha: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO diff_viewed_files (feature_id, file_path, blob_sha, viewed_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(feature_id, file_path) DO UPDATE SET blob_sha = excluded.blob_sha, viewed_at = excluded.viewed_at",
      ).run(input.featureId, input.filePath, input.blobSha);
      return { success: true };
    }),

  /** Unmark a file as viewed */
  unmarkViewed: publicProcedure
    .input(z.object({ featureId: z.number(), filePath: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "DELETE FROM diff_viewed_files WHERE feature_id = ? AND file_path = ?",
      ).run(input.featureId, input.filePath);
      return { success: true };
    }),

  /** Clear all viewed files for a feature */
  clearAll: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const result = db
        .prepare("DELETE FROM diff_viewed_files WHERE feature_id = ?")
        .run(input.featureId);
      return { deleted: result.changes };
    }),
});
