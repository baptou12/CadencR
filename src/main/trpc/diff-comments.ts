import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";

interface DiffCommentRow {
  id: number;
  feature_id: number;
  file_path: string;
  line_number: number;
  side: "old" | "new";
  content: string;
  status: "pending" | "sent" | "resolved";
  created_at: string;
}

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
    .mutation(({ input }) => {
      const db = getDatabase();
      const result = db
        .prepare(
          "INSERT INTO diff_comments (feature_id, file_path, line_number, side, content, status) VALUES (?, ?, ?, ?, ?, 'pending')",
        )
        .run(input.featureId, input.filePath, input.lineNumber, input.side, input.content);
      return {
        id: result.lastInsertRowid as number,
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
    .query(({ input }) => {
      const db = getDatabase();
      const rows = db
        .prepare(
          "SELECT id, feature_id, file_path, line_number, side, content, status, created_at FROM diff_comments WHERE feature_id = ? ORDER BY file_path, line_number ASC",
        )
        .all(input.featureId) as DiffCommentRow[];
      return rows;
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
    .mutation(({ input }) => {
      const db = getDatabase();
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
      db.prepare(`UPDATE diff_comments SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return { success: true };
    }),

  /** Delete a comment */
  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("DELETE FROM diff_comments WHERE id = ?").run(input.id);
      return { success: true };
    }),

  /** Batch-update pending comments to "sent" status for a feature */
  markAsSent: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const result = db
        .prepare(
          "UPDATE diff_comments SET status = 'sent' WHERE feature_id = ? AND status = 'pending'",
        )
        .run(input.featureId);
      return { updated: result.changes };
    }),
});
