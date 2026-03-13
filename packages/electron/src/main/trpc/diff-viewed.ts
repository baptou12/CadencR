import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { queryAll, execute } from "../db/query";
import type { Schema } from "effect";
import { DiffViewedRowSchema } from "../effect/schemas/db-schemas";
import { AppRuntime } from "../effect/runtime";

type DiffViewedFileRow = Schema.Schema.Type<typeof DiffViewedRowSchema>;

export const diffViewedRouter = router({
  /** List all viewed files for a feature */
  list: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      return await AppRuntime.runPromise(queryAll<DiffViewedFileRow>(
        "SELECT id, feature_id, file_path, blob_sha, viewed_at FROM diff_viewed_files WHERE feature_id = ? ORDER BY file_path ASC",
        input.featureId,
      ));
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
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute(
        "INSERT INTO diff_viewed_files (feature_id, file_path, blob_sha, viewed_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(feature_id, file_path) DO UPDATE SET blob_sha = excluded.blob_sha, viewed_at = excluded.viewed_at",
        input.featureId, input.filePath, input.blobSha,
      ));
      return { success: true };
    }),

  /** Unmark a file as viewed */
  unmarkViewed: publicProcedure
    .input(z.object({ featureId: z.number(), filePath: z.string() }))
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute(
        "DELETE FROM diff_viewed_files WHERE feature_id = ? AND file_path = ?",
        input.featureId, input.filePath,
      ));
      return { success: true };
    }),

  /** Clear all viewed files for a feature */
  clearAll: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      const result = await AppRuntime.runPromise(execute(
        "DELETE FROM diff_viewed_files WHERE feature_id = ?",
        input.featureId,
      ));
      return { deleted: result.changes };
    }),
});
