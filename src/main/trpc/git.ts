import { z } from "zod";
import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import { queryOne, queryAll, execute } from "../db/query";
import { openInTerminal, openInZed } from "../git/worktree";
import {
  createWorktreeEffect,
  removeWorktreeEffect,
  listWorktreesEffect,
  getWorktreeInfoEffect,
  buildBranchName,
  setupWorktreeForFeatureEffect,
  getCurrentBranchEffect,
  getGitStatsEffect,
  getDiffEffect,
  getChangedFilesEffect,
  getOriginalBranchEffect,
  checkMergeConflictsEffect,
  mergeBranchEffect,
  deleteLocalBranchEffect,
  hasUncommittedChangesEffect,
  getFileContentEffect,
  getCommitLogEffect,
  getRecentCommitsEffect,
  getCommitDiffEffect,
  execGit,
} from "../effect/services/GitWorktree";
import { AppRuntime } from "../effect/runtime";
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
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ id: number; name: string; path: string }>(
            "SELECT id, name, path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project) return yield* Effect.fail(new Error(`Project not found: ${input.projectId}`));

          const prefixRow = yield* queryOne<{ branch_prefix: string | null }>(
            "SELECT branch_prefix FROM projects WHERE id = ?",
            input.projectId,
          );
          const prefix = prefixRow?.branch_prefix ?? "feature/";
          const branchName = buildBranchName(prefix, input.featureTitle);

          const result = yield* createWorktreeEffect(project.path, branchName, project.name);

          yield* execute(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
            input.featureId, "worktree_path", result.worktreePath,
          );
          yield* execute(
            "INSERT INTO feature_settings (feature_id, key, value) VALUES (?, ?, ?) ON CONFLICT(feature_id, key) DO UPDATE SET value = excluded.value",
            input.featureId, "worktree_branch", result.branch,
          );

          return result;
        }),
      );
    }),

  /** Remove a git worktree */
  removeWorktree: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project) return yield* Effect.fail(new Error(`Project not found: ${input.projectId}`));

          const wtRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            input.featureId,
          );
          if (!wtRow) return yield* Effect.fail(new Error("No worktree found for this feature"));

          yield* removeWorktreeEffect(project.path, wtRow.value);

          yield* execute(
            "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
            input.featureId,
          );

          return { success: true };
        }),
      );
    }),

  /** Get worktree info for a feature */
  getWorktreeInfo: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        featureId: z.number(),
      }),
    )
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project) return null;

          const wtRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            input.featureId,
          );
          if (!wtRow) return null;

          return yield* getWorktreeInfoEffect(project.path, wtRow.value);
        }),
      );
    }),

  /** Get git diff stats (LOC changed) for a feature's worktree or project path */
  getStats: publicProcedure
    .input(z.object({
      featureId: z.number(),
      mode: z.enum(["worktree", "branch"]).optional(),
      targetBranch: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) return { filesChanged: 0, insertions: 0, deletions: 0 };
      return AppRuntime.runPromise(
        getGitStatsEffect(gitPath, input.mode ?? "worktree", input.targetBranch),
      );
    }),

  /** Get the current branch for a project */
  getBranch: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return null;
          return yield* getCurrentBranchEffect(project.path);
        }),
      );
    }),

  /** Get raw unified diff for a feature (or a specific commit) */
  getDiff: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
        commitSha: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) return "";
      if (input.commitSha) {
        return AppRuntime.runPromise(getCommitDiffEffect(gitPath, input.commitSha));
      }
      return AppRuntime.runPromise(getDiffEffect(gitPath, input.mode, input.targetBranch));
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
    .query(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) return [];
      return AppRuntime.runPromise(
        getChangedFilesEffect(gitPath, input.mode, input.targetBranch),
      );
    }),

  /** Retry worktree setup for a feature */
  retryWorktreeSetup: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(({ input }) => {
      AppRuntime.runPromise(
        setupWorktreeForFeatureEffect(input.projectId, input.featureId),
      ).catch((err) => {
        console.error("[retryWorktreeSetup] Failed:", err);
      });
      return { success: true };
    }),

  /** Open a worktree/project path in the system terminal */
  openInTerminal: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) throw new Error("No working directory found for this feature");

      await openInTerminal(gitPath);
      return { success: true };
    }),

  /** Open a worktree/project path in Zed editor */
  openInZed: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) throw new Error("No working directory found for this feature");

      await openInZed(gitPath);
      return { success: true };
    }),

  /** List all git-tracked files for a feature's worktree/project */
  listFiles: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) return [];
      const { stdout } = await AppRuntime.runPromise(
        execGit("git ls-files", { cwd: gitPath, maxBuffer: 10 * 1024 * 1024 }),
      ).catch(() => ({ stdout: "" }));
      return stdout.split("\n").filter(Boolean);
    }),

  /** Get the original branch from which the feature's worktree branch was created */
  getOriginalBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          const branchRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
            input.featureId,
          );
          if (!branchRow?.value) return yield* Effect.fail(new Error("No worktree branch found for this feature"));

          const originalBranch = yield* getOriginalBranchEffect(project.path, branchRow.value);
          return { originalBranch, worktreeBranch: branchRow.value };
        }),
      );
    }),

  /** Check if merging the feature branch into its original branch would conflict */
  checkMergeConflicts: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          const branchRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
            input.featureId,
          );
          if (!branchRow?.value) return yield* Effect.fail(new Error("No worktree branch found for this feature"));

          const targetBranch = yield* getOriginalBranchEffect(project.path, branchRow.value);
          return yield* checkMergeConflictsEffect(project.path, branchRow.value, targetBranch);
        }),
      );
    }),

  /** Merge the feature branch into its original branch using --no-ff */
  mergeFeatureBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          const branchRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
            input.featureId,
          );
          if (!branchRow?.value) return yield* Effect.fail(new Error("No worktree branch found for this feature"));

          const targetBranch = yield* getOriginalBranchEffect(project.path, branchRow.value);
          return yield* mergeBranchEffect(project.path, branchRow.value, targetBranch);
        }),
      );
    }),

  /** Delete the feature's local branch (-d, safe — only if fully merged) */
  deleteFeatureBranch: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          const branchRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
            input.featureId,
          );
          if (!branchRow?.value) return yield* Effect.fail(new Error("No worktree branch found for this feature"));

          return yield* deleteLocalBranchEffect(project.path, branchRow.value);
        }),
      );
    }),

  /** Get blob SHAs for all changed files in a feature's worktree */
  getFileBlobShas: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      const wtRow = await AppRuntime.runPromise(
        queryOne<{ value: string }>(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
          input.featureId,
        ),
      );
      if (!wtRow?.value) return {};

      const worktreePath = wtRow.value;
      const result: Record<string, string> = {};

      try {
        const [changedResult, untrackedResult] = await Promise.all([
          AppRuntime.runPromise(execGit("git diff HEAD --name-only", { cwd: worktreePath })),
          AppRuntime.runPromise(execGit("git ls-files --others --exclude-standard", { cwd: worktreePath })),
        ]);

        const changedFiles = changedResult.stdout.trim().split("\n").filter(Boolean);
        const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

        let branchChangedFiles: string[] = [];
        try {
          const branchRow = await AppRuntime.runPromise(
            queryOne<{ value: string }>(
              "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
              input.featureId,
            ),
          );
          if (branchRow?.value) {
            const { stdout: mergeBaseOut } = await AppRuntime.runPromise(
              execGit("git merge-base HEAD main || git merge-base HEAD master", {
                cwd: worktreePath,
                shell: "/bin/sh",
              }),
            );
            const mergeBase = mergeBaseOut.trim();
            if (mergeBase) {
              const { stdout: branchDiffOut } = await AppRuntime.runPromise(
                execGit(`git diff ${mergeBase} HEAD --name-only`, { cwd: worktreePath }),
              );
              branchChangedFiles = branchDiffOut.trim().split("\n").filter(Boolean);
            }
          }
        } catch {
          // merge-base may fail, that's ok
        }

        const allFiles = [...new Set([...changedFiles, ...untrackedFiles, ...branchChangedFiles])];

        await Promise.all(
          allFiles.map(async (filePath) => {
            try {
              const { stdout: blobSha } = await AppRuntime.runPromise(
                execGit(`git hash-object "${filePath}"`, { cwd: worktreePath }),
              );
              if (blobSha.trim()) {
                result[filePath] = blobSha.trim();
              }
            } catch {
              try {
                const { stdout: blobSha } = await AppRuntime.runPromise(
                  execGit(`git rev-parse HEAD:"${filePath}"`, { cwd: worktreePath }),
                );
                if (blobSha.trim()) {
                  result[filePath] = blobSha.trim();
                }
              } catch {
                // File might not exist, skip
              }
            }
          }),
        );
      } catch {
        // If git commands fail, return empty map
      }

      return result;
    }),

  /** Check if the feature's worktree has uncommitted/untracked changes */
  hasUncommittedChanges: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const wtRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            input.featureId,
          );
          if (!wtRow?.value) return { hasChanges: false };
          const hasChanges = yield* hasUncommittedChangesEffect(wtRow.value);
          return { hasChanges };
        }),
      );
    }),

  /** Delete the feature's worktree (only if no uncommitted changes) */
  deleteWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(async ({ input }) => {
      const { project, wtRow } = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          const wtRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            input.featureId,
          );
          if (!wtRow?.value) return yield* Effect.fail(new Error("No worktree found for this feature"));

          return { project, wtRow };
        }),
      );

      const hasChanges = await AppRuntime.runPromise(hasUncommittedChangesEffect(wtRow.value));
      if (hasChanges) {
        return { success: false, error: "Worktree has uncommitted or untracked changes" };
      }

      try {
        await AppRuntime.runPromise(removeWorktreeEffect(project.path, wtRow.value));
        await AppRuntime.runPromise(
          execute(
            "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
            input.featureId,
          ),
        );
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),

  listProjectWorktrees: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          let worktrees;
          try {
            worktrees = yield* listWorktreesEffect(project.path);
          } catch {
            return [];
          }

          const repoRoot = project.path.replace(/\/+$/, "");
          const secondary = worktrees.filter(
            (w) => w.path.replace(/\/+$/, "") !== repoRoot && !w.isBare,
          );

          const featureLookup = yield* queryAll<{
            worktree_path: string;
            feature_id: number;
            feature_title: string;
            feature_status: string;
          }>(
            `SELECT fs.value AS worktree_path, f.id AS feature_id, f.title AS feature_title, f.status AS feature_status
             FROM feature_settings fs
             JOIN features f ON f.id = fs.feature_id
             WHERE fs.key = 'worktree_path' AND f.project_id = ?`,
            input.projectId,
          );

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
      );
    }),

  /** Get file content for expand-in-diff (old + new versions) */
  getFileContent: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        filePath: z.string(),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
        commitSha: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) return { oldContent: "", newContent: "" };

      if (input.commitSha) {
        const [oldContent, newContent] = await Promise.all([
          AppRuntime.runPromise(getFileContentEffect(gitPath, input.filePath, `${input.commitSha}^`)),
          AppRuntime.runPromise(getFileContentEffect(gitPath, input.filePath, input.commitSha)),
        ]);
        return { oldContent, newContent };
      }

      if (input.mode === "worktree") {
        const [oldContent, newContent] = await Promise.all([
          AppRuntime.runPromise(getFileContentEffect(gitPath, input.filePath, "HEAD")),
          AppRuntime.runPromise(getFileContentEffect(gitPath, input.filePath)), // working tree
        ]);
        return { oldContent, newContent };
      }

      // Branch mode
      const branchRow = await AppRuntime.runPromise(
        queryOne<{ value: string }>(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
          input.featureId,
        ),
      );
      const baseBranch = branchRow?.value
        ? await AppRuntime.runPromise(getOriginalBranchEffect(gitPath, branchRow.value)).catch(
            () => input.targetBranch ?? "main",
          )
        : input.targetBranch ?? "main";

      const [oldContent, newContent] = await Promise.all([
        AppRuntime.runPromise(getFileContentEffect(gitPath, input.filePath, baseBranch)),
        AppRuntime.runPromise(getFileContentEffect(gitPath, input.filePath, "HEAD")),
      ]);
      return { oldContent, newContent };
    }),

  /** Get commit log for a feature's branch */
  getCommitLog: publicProcedure
    .input(z.object({
      featureId: z.number(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      const gitPath = await AppRuntime.runPromise(resolveFeatureGitPath(input.featureId));
      if (!gitPath) return { commits: [], isOnBaseBranch: true };

      // Determine current branch name
      const branchRow = await AppRuntime.runPromise(
        queryOne<{ value: string }>(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
          input.featureId,
        ),
      );
      const branchName =
        branchRow?.value ?? (await AppRuntime.runPromise(getCurrentBranchEffect(gitPath)));
      if (!branchName) return { commits: [], isOnBaseBranch: true };

      let baseBranch: string;
      try {
        baseBranch = await AppRuntime.runPromise(getOriginalBranchEffect(gitPath, branchName));
      } catch {
        // Can't determine base branch — fall back to recent commits
        const commits = await AppRuntime.runPromise(
          getRecentCommitsEffect(gitPath, branchName, input.limit),
        );
        return { commits, isOnBaseBranch: true };
      }

      // On the base branch — show recent commit history
      if (branchName === baseBranch) {
        const commits = await AppRuntime.runPromise(
          getRecentCommitsEffect(gitPath, branchName, input.limit),
        );
        return { commits, isOnBaseBranch: true };
      }

      // On a feature branch — show branch-specific commits
      const commits = await AppRuntime.runPromise(
        getCommitLogEffect(gitPath, baseBranch, branchName),
      );
      return { commits, isOnBaseBranch: false };
    }),

  removeOrphanWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), worktreePath: z.string() }))
    .mutation(async ({ input }) => {
      const project = await AppRuntime.runPromise(
        queryOne<{ path: string }>(
          "SELECT path FROM projects WHERE id = ?",
          input.projectId,
        ),
      );
      if (!project?.path) throw new Error("Project not found");

      try {
        await AppRuntime.runPromise(removeWorktreeEffect(project.path, input.worktreePath));
        return { success: true };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
});
