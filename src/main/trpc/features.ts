import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { FeatureRow, ProjectRow, PlanRow, CountRow, SettingRow } from "../db/types";
import { createWorktree, buildBranchName } from "../git/worktree";

export const FEATURE_STATUSES = ["draft", "planned", "in-progress", "review", "done"] as const;
export type FeatureStatus = (typeof FEATURE_STATUSES)[number];

const featureStatusSchema = z.enum(FEATURE_STATUSES);

export const featuresRouter = router({
  listByProject: publicProcedure
    .input(
      z.object({
        project_id: z.number(),
        status: featureStatusSchema.optional(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase();
      if (input.status) {
        return db
          .prepare(
            "SELECT id, project_id, title, status, created_at FROM features WHERE project_id = ? AND status = ? ORDER BY created_at DESC",
          )
          .all(input.project_id, input.status) as FeatureRow[];
      }
      return db
        .prepare(
          "SELECT id, project_id, title, status, created_at FROM features WHERE project_id = ? ORDER BY created_at DESC",
        )
        .all(input.project_id) as FeatureRow[];
    }),

  create: publicProcedure
    .input(z.object({ project_id: z.number(), title: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      const result = db
        .prepare("INSERT INTO features (project_id, title) VALUES (?, ?)")
        .run(input.project_id, input.title);
      const featureId = Number(result.lastInsertRowid);

      // Auto-create worktree if project has a path
      const project = db
        .prepare("SELECT name, path FROM projects WHERE id = ?")
        .get(input.project_id) as Pick<ProjectRow, "name" | "path"> | undefined;

      if (project?.path) {
        try {
          const prefixRow = db
            .prepare(
              "SELECT value FROM project_settings WHERE project_id = ? AND key = 'branch_prefix'",
            )
            .get(input.project_id) as SettingRow | undefined;
          const prefix = prefixRow?.value ?? "feature/";
          const branchName = buildBranchName(prefix, input.title);
          const wt = createWorktree(project.path, branchName, project.name);

          // Store worktree info in feature settings
          db.prepare(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
          ).run(featureId, "worktree_path", wt.worktreePath);
          db.prepare(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
          ).run(featureId, "worktree_branch", wt.branch);
        } catch {
          // Worktree creation is best-effort — don't fail feature creation
          console.warn("Failed to create worktree for feature:", input.title);
        }
      }

      return { id: featureId };
    }),

  updateStatus: publicProcedure
    .input(z.object({ id: z.number(), status: featureStatusSchema }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare("UPDATE features SET status = ? WHERE id = ?").run(input.status, input.id);
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => {
    const db = getDatabase();
    db.prepare("DELETE FROM features WHERE id = ?").run(input.id);
    return { success: true };
  }),

  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      return db
        .prepare(
          "SELECT id, project_id, title, status, created_at FROM features WHERE id = ?",
        )
        .get(input.id) as FeatureRow | undefined;
    }),

  getPlanProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const plan = db
        .prepare("SELECT id FROM plans WHERE feature_id = ? LIMIT 1")
        .get(input.feature_id) as Pick<PlanRow, "id"> | undefined;
      if (!plan) {
        return { total: 0, done: 0 };
      }
      const total = (
        db.prepare("SELECT COUNT(*) as count FROM phases WHERE plan_id = ?").get(plan.id) as CountRow
      ).count;
      const done = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'done'",
          )
          .get(plan.id) as CountRow
      ).count;
      return { total, done };
    }),

  getProgress: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const plan = db
        .prepare("SELECT id FROM plans WHERE feature_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(input.feature_id) as Pick<PlanRow, "id"> | undefined;
      if (!plan) {
        return { total: 0, done: 0 };
      }
      const total = (
        db.prepare("SELECT COUNT(*) as count FROM phases WHERE plan_id = ?").get(plan.id) as CountRow
      ).count;
      const done = (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM phases WHERE plan_id = ? AND status = 'done'",
          )
          .get(plan.id) as CountRow
      ).count;
      return { total, done };
    }),

  getSettings: publicProcedure
    .input(z.object({ feature_id: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const rows = db
        .prepare("SELECT key, value FROM feature_settings WHERE feature_id = ?")
        .all(input.feature_id) as SettingRow[];
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }),

  setSetting: publicProcedure
    .input(z.object({ feature_id: z.number(), key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.feature_id, input.key, input.value);
      return { success: true };
    }),
});
