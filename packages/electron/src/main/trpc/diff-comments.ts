import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { queryAll, execute } from "../db/query";
import type { Schema } from "effect";
import { DiffCommentRowSchema } from "../effect/schemas/db-schemas";
import { AppRuntime } from "../effect/runtime";

type DiffCommentRow = Schema.Schema.Type<typeof DiffCommentRowSchema>;

export const diffCommentsRouter = router({
  /** Create a new diff comment */
  create: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        filePath: z.string(),
        lineNumber: z.number(),
        side: z.enum(["old", "new"]),
        content: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await AppRuntime.runPromise(execute(
        "INSERT INTO diff_comments (feature_id, file_path, line_number, side, content, status) VALUES (?, ?, ?, ?, ?, 'pending')",
        input.featureId, input.filePath, input.lineNumber, input.side, input.content,
      ));
      return {
        id: result.lastInsertRowid,
        featureId: input.featureId,
        filePath: input.filePath,
        lineNumber: input.lineNumber,
        side: input.side,
        content: input.content,
        status: "pending" as const,
      };
    }),

  /** List all comments for a feature */
  list: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      return await AppRuntime.runPromise(queryAll<DiffCommentRow>(
        "SELECT id, feature_id, file_path, line_number, side, content, status, created_at FROM diff_comments WHERE feature_id = ? ORDER BY file_path, line_number ASC",
        input.featureId,
      ));
    }),

  /** Update a comment's content or status */
  update: publicProcedure
    .input(
      z.object({
        id: z.number(),
        content: z.string().optional(),
        status: z.enum(["pending", "sent", "resolved"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const sets: string[] = [];
      const params: (string | number)[] = [];

      if (input.content !== undefined) {
        sets.push("content = ?");
        params.push(input.content);
      }
      if (input.status !== undefined) {
        sets.push("status = ?");
        params.push(input.status);
      }

      if (sets.length === 0) {
        throw new Error("No fields to update");
      }

      params.push(input.id);
      await AppRuntime.runPromise(execute(
        `UPDATE diff_comments SET ${sets.join(", ")} WHERE id = ?`,
        ...params,
      ));
      return { success: true };
    }),

  /** Delete a comment */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute(
        "DELETE FROM diff_comments WHERE id = ?",
        input.id,
      ));
      return { success: true };
    }),

  /** Batch-update pending comments to "sent" status for a feature */
  markAsSent: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      const result = await AppRuntime.runPromise(execute(
        "UPDATE diff_comments SET status = 'sent' WHERE feature_id = ? AND status = 'pending'",
        input.featureId,
      ));
      return { updated: result.changes };
    }),

  /** Delete all pending comments for a feature (used after delivering to an agent) */
  deletePending: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      const result = await AppRuntime.runPromise(execute(
        "DELETE FROM diff_comments WHERE feature_id = ? AND status = 'pending'",
        input.featureId,
      ));
      return { deleted: result.changes };
    }),
});
