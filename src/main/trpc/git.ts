import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { getDatabase } from "../db/database";
import type { SettingRow, ProjectRow } from "../db/types";
import { execSync } from "node:child_process";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  getWorktreeInfo,
  openInTerminal,
  openInZed,
  buildBranchName,
  getGitStats,
  getDiff,
  getChangedFiles,
  getCurrentBranch,
  setupWorktreeForFeature,
  getOriginalBranch,
  checkMergeConflicts,
  mergeBranch,
  deleteLocalBranch,
  hasUncommittedChanges,
} from "../git/worktree";
import { resolveFeatureGitPath } from "./shared";

export const gitRouter = router({
  /** Create a git worktree for a feature */
  createWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
        featureTitle: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT id, name, path FROM projects WHERE id = ?")
        .get(input.projectId) as ProjectRow | undefined;
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      const prefixRow = db
        .prepare("SELECT branch_prefix FROM projects WHERE id = ?")
        .get(input.projectId) as { branch_prefix: string | null } | undefined;
      const prefix = prefixRow?.branch_prefix ?? "feature/";

      const branchName = buildBranchName(prefix, input.featureTitle);
      const result = createWorktree(project.path, branchName, project.name);

      db.prepare(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.featureId, "worktree_path", result.worktreePath);
      db.prepare(
        "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
      ).run(input.featureId, "worktree_branch", result.branch);

      return result;
    }),

  /** Remove a git worktree */
  removeWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow) throw new Error("No worktree found for this feature");

      removeWorktree(project.path, wtRow.value);

      db.prepare(
        "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
      ).run(input.featureId);

      return { success: true };
    }),

  /** Get worktree info for a feature */
  getWorktreeInfo: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project) return null;

      const wtRow = db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow) return null;

      return getWorktreeInfo(project.path, wtRow.value);
    }),

  /** Get git diff stats (LOC changed) for a feature's worktree or project path */
  getStats: publicProcedure
    .input(z.object({
      featureId: z.number(),
      mode: z.enum(["worktree", "branch"]).optional(),
      targetBranch: z.string().optional(),
    }))
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return { filesChanged: 0, insertions: 0, deletions: 0 };
      return getGitStats(gitPath, input.mode ?? "worktree", input.targetBranch);
    }),

  /** Get the current branch for a project */
  getBranch: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) return null;
      return getCurrentBranch(project.path);
    }),

  /** Get raw unified diff for a feature */
  getDiff: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return "";
      return getDiff(gitPath, input.mode, input.targetBranch);
    }),

  /** Get list of changed files with per-file line counts */
  getChangedFiles: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
      }),
    )
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return [];
      return getChangedFiles(gitPath, input.mode, input.targetBranch);
    }),

  /** Retry worktree setup for a feature */
  retryWorktreeSetup: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(({ input }) => {
      setupWorktreeForFeature(input.projectId, input.featureId).catch((err) => {
        console.error("[retryWorktreeSetup] Failed:", err);
      });
      return { success: true };
    }),

  /** Open a worktree/project path in the system terminal */
  openInTerminal: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) throw new Error("No working directory found for this feature");

      openInTerminal(gitPath);
      return { success: true };
    }),

  /** Open a worktree/project path in Zed editor */
  openInZed: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) throw new Error("No working directory found for this feature");

      openInZed(gitPath);
      return { success: true };
    }),

  /** List all git-tracked files for a feature's worktree/project */
  listFiles: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const gitPath = resolveFeatureGitPath(input.featureId);
      if (!gitPath) return [];
      const output = execSync("git ls-files", { cwd: gitPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
      return output.split("\n").filter(Boolean);
    }),

  /** Get the original branch from which the feature's worktree branch was created */
  getOriginalBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      const originalBranch = await getOriginalBranch(project.path, branchRow.value);
      return { originalBranch, worktreeBranch: branchRow.value };
    }),

  /** Check if merging the feature branch into its original branch would conflict */
  checkMergeConflicts: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      const targetBranch = await getOriginalBranch(project.path, branchRow.value);
      return checkMergeConflicts(project.path, branchRow.value, targetBranch);
    }),

  /** Merge the feature branch into its original branch using --no-ff */
  mergeFeatureBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      const targetBranch = await getOriginalBranch(project.path, branchRow.value);
      return mergeBranch(project.path, branchRow.value, targetBranch);
    }),

  /** Delete the feature's local branch (-d, safe — only if fully merged) */
  deleteFeatureBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const branchRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
        .get(input.featureId) as SettingRow | undefined;
      if (!branchRow?.value) throw new Error("No worktree branch found for this feature");

      return deleteLocalBranch(project.path, branchRow.value);
    }),

  /** Get blob SHAs for all changed files in a feature's worktree */
  getFileBlobShas: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const wtRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow?.value) return {};

      const worktreePath = wtRow.value;
      const result: Record<string, string> = {};

      try {
        const changedFiles = execSync("git diff HEAD --name-only", {
          cwd: worktreePath,
          encoding: "utf-8",
        })
          .trim()
          .split("\n")
          .filter(Boolean);

        const untrackedFiles = execSync("git ls-files --others --exclude-standard", {
          cwd: worktreePath,
          encoding: "utf-8",
        })
          .trim()
          .split("\n")
          .filter(Boolean);

        let branchChangedFiles: string[] = [];
        try {
          const branchRow = db
            .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'")
            .get(input.featureId) as SettingRow | undefined;
          if (branchRow?.value) {
            const mergeBase = execSync(`git merge-base HEAD main || git merge-base HEAD master`, {
              cwd: worktreePath,
              encoding: "utf-8",
              shell: "/bin/sh",
            }).trim();
            if (mergeBase) {
              branchChangedFiles = execSync(`git diff ${mergeBase} HEAD --name-only`, {
                cwd: worktreePath,
                encoding: "utf-8",
              })
                .trim()
                .split("\n")
                .filter(Boolean);
            }
          }
        } catch {
          // merge-base may fail, that's ok
        }

        const allFiles = [...new Set([...changedFiles, ...untrackedFiles, ...branchChangedFiles])];

        for (const filePath of allFiles) {
          try {
            const blobSha = execSync(`git hash-object "${filePath}"`, {
              cwd: worktreePath,
              encoding: "utf-8",
            }).trim();
            if (blobSha) {
              result[filePath] = blobSha;
            }
          } catch {
            try {
              const blobSha = execSync(`git rev-parse HEAD:"${filePath}"`, {
                cwd: worktreePath,
                encoding: "utf-8",
              }).trim();
              if (blobSha) {
                result[filePath] = blobSha;
              }
            } catch {
              // File might not exist, skip
            }
          }
        }
      } catch {
        // If git commands fail, return empty map
      }

      return result;
    }),

  /** Check if the feature's worktree has uncommitted/untracked changes */
  hasUncommittedChanges: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      const db = getDatabase();
      const wtRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow?.value) return { hasChanges: false };
      const hasChanges = await hasUncommittedChanges(wtRow.value);
      return { hasChanges };
    }),

  /** Delete the feature's worktree (only if no uncommitted changes) */
  deleteWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      const wtRow = db
        .prepare("SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'")
        .get(input.featureId) as SettingRow | undefined;
      if (!wtRow?.value) throw new Error("No worktree found for this feature");

      const hasChanges = await hasUncommittedChanges(wtRow.value);
      if (hasChanges) {
        return { success: false, error: "Worktree has uncommitted or untracked changes" };
      }

      try {
        await removeWorktree(project.path, wtRow.value);
        db.prepare(
          "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
        ).run(input.featureId);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  listProjectWorktrees: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      let worktrees;
      try {
        worktrees = listWorktrees(project.path);
      } catch {
        return [];
      }

      const repoRoot = project.path.replace(/\/+$/, "");
      const secondary = worktrees.filter(
        (w) => w.path.replace(/\/+$/, "") !== repoRoot && !w.isBare,
      );

      const featureLookup = db
        .prepare(
          `SELECT fs.value AS worktree_path, f.id AS feature_id, f.title AS feature_title, f.status AS feature_status
           FROM feature_settings fs
           JOIN features f ON f.id = fs.feature_id
           WHERE fs.key = 'worktree_path' AND f.project_id = ?`,
        )
        .all(input.projectId) as Array<{
        worktree_path: string;
        feature_id: number;
        feature_title: string;
        feature_status: string;
      }>;

      const byPath = new Map(featureLookup.map((r) => [r.worktree_path, r]));

      return secondary.map((w) => {
        const feat = byPath.get(w.path);
        return {
          path: w.path,
          branch: w.branch,
          head: w.head,
          featureId: feat?.feature_id ?? null,
          featureTitle: feat?.feature_title ?? null,
          featureStatus: feat?.feature_status ?? null,
        };
      });
    }),

  removeOrphanWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), worktreePath: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase();
      const project = db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as Pick<ProjectRow, "path"> | undefined;
      if (!project?.path) throw new Error("Project not found");

      try {
        await removeWorktree(project.path, input.worktreePath);
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
});
