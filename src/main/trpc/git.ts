import { z } from "zod";
import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import { queryOne, queryAll, execute } from "../db/query";
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
  getFileContentBatchEffect,
  getCommitLogEffect,
  getRecentCommitsEffect,
  getCommitDiffEffect,
  openInTerminalEffect,
  openInZedEffect,
  execGit,
  type WorktreeInfo,
  type CommitInfo,
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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return { filesChanged: 0, insertions: 0, deletions: 0 };
          return yield* getGitStatsEffect(gitPath, input.mode ?? "worktree", input.targetBranch);
        }),
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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return "";
          if (input.commitSha) {
            return yield* getCommitDiffEffect(gitPath, input.commitSha);
          }
          return yield* getDiffEffect(gitPath, input.mode, input.targetBranch);
        }),
      );
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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return [];
          return yield* getChangedFilesEffect(gitPath, input.mode, input.targetBranch);
        }),
      );
    }),

  /** Retry worktree setup for a feature */
  retryWorktreeSetup: publicProcedure
    .input(z.object({ projectId: z.number(), featureId: z.number() }))
    .mutation(({ input }) => {
      // Fire-and-forget: worktree setup runs in background so the UI stays responsive.
      // The renderer polls worktree status separately to reflect completion.
      AppRuntime.runPromise(
        setupWorktreeForFeatureEffect(input.projectId, input.featureId).pipe(
          Effect.catchAll((err) => {
            console.error("[retryWorktreeSetup] Failed:", err);
            return Effect.succeed(undefined);
          }),
        ),
      );
      return { success: true };
    }),

  /** Open a worktree/project path in the system terminal */
  openInTerminal: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return yield* Effect.fail(new Error("No working directory found for this feature"));
          yield* openInTerminalEffect(gitPath);
          return { success: true };
        }),
      );
    }),

  /** Open a worktree/project path in Zed editor */
  openInZed: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return yield* Effect.fail(new Error("No working directory found for this feature"));
          yield* openInZedEffect(gitPath);
          return { success: true };
        }),
      );
    }),

  /** List all git-tracked files for a feature's worktree/project */
  listFiles: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return [] as string[];
          const { stdout } = yield* execGit("git ls-files", { cwd: gitPath, maxBuffer: 10 * 1024 * 1024 }).pipe(
            Effect.catchAll(() => Effect.succeed({ stdout: "" })),
          );
          return stdout.split("\n").filter(Boolean);
        }),
      );
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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const wtRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            input.featureId,
          );
          if (!wtRow?.value) return {} as Record<string, string>;

          const worktreePath = wtRow.value;

          return yield* Effect.gen(function* () {
            const [changedResult, untrackedResult] = yield* Effect.all(
              [
                execGit("git diff HEAD --name-only", { cwd: worktreePath }),
                execGit("git ls-files --others --exclude-standard", { cwd: worktreePath }),
              ],
              { concurrency: "unbounded" },
            );

            const changedFiles = changedResult.stdout.trim().split("\n").filter(Boolean);
            const untrackedFiles = untrackedResult.stdout.trim().split("\n").filter(Boolean);

            const branchChangedFiles = yield* Effect.gen(function* () {
              const branchRow = yield* queryOne<{ value: string }>(
                "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
                input.featureId,
              );
              if (!branchRow?.value) return [] as string[];
              const { stdout: mergeBaseOut } = yield* execGit(
                "git merge-base HEAD main || git merge-base HEAD master",
                { cwd: worktreePath, shell: "/bin/sh" },
              );
              const mergeBase = mergeBaseOut.trim();
              if (!mergeBase) return [] as string[];
              const { stdout: branchDiffOut } = yield* execGit(
                `git diff ${mergeBase} HEAD --name-only`,
                { cwd: worktreePath },
              );
              return branchDiffOut.trim().split("\n").filter(Boolean);
            }).pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

            const allFiles = [...new Set([...changedFiles, ...untrackedFiles, ...branchChangedFiles])];

            const blobEntries = yield* Effect.forEach(
              allFiles,
              (filePath) =>
                execGit(`git hash-object "${filePath}"`, { cwd: worktreePath }).pipe(
                  Effect.map(({ stdout }) => ({ filePath, sha: stdout.trim() })),
                  Effect.catchAll(() =>
                    execGit(`git rev-parse HEAD:"${filePath}"`, { cwd: worktreePath }).pipe(
                      Effect.map(({ stdout }) => ({ filePath, sha: stdout.trim() })),
                      Effect.catchAll(() => Effect.succeed({ filePath, sha: "" })),
                    ),
                  ),
                ),
              { concurrency: "unbounded" },
            );

            return Object.fromEntries(
              blobEntries.filter(({ sha }) => sha).map(({ filePath, sha }) => [filePath, sha]),
            ) as Record<string, string>;
          }).pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, string>)));
        }),
      );
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
      return AppRuntime.runPromise(
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

          const hasChanges = yield* hasUncommittedChangesEffect(wtRow.value);
          if (hasChanges) {
            return { success: false as const, error: "Worktree has uncommitted or untracked changes" };
          }

          return yield* removeWorktreeEffect(project.path, wtRow.value).pipe(
            Effect.andThen(() =>
              execute(
                "DELETE FROM feature_settings WHERE feature_id = ? AND key IN ('worktree_path', 'worktree_branch')",
                input.featureId,
              ),
            ),
            Effect.map(() => ({ success: true as const })),
            Effect.catchAll((err) =>
              Effect.succeed({
                success: false as const,
                error: err instanceof Error ? err.message : String(err),
              }),
            ),
          );
        }),
      );
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

          const worktrees = yield* listWorktreesEffect(project.path).pipe(
            Effect.catchAll(() => Effect.succeed([] as WorktreeInfo[])),
          );

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
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return { oldContent: "", newContent: "" };

          if (input.commitSha) {
            const [oldContent, newContent] = yield* Effect.all(
              [
                getFileContentEffect(gitPath, input.filePath, `${input.commitSha}^`),
                getFileContentEffect(gitPath, input.filePath, input.commitSha),
              ],
              { concurrency: "unbounded" },
            );
            return { oldContent, newContent };
          }

          if (input.mode === "worktree") {
            const [oldContent, newContent] = yield* Effect.all(
              [
                getFileContentEffect(gitPath, input.filePath, "HEAD"),
                getFileContentEffect(gitPath, input.filePath), // working tree
              ],
              { concurrency: "unbounded" },
            );
            return { oldContent, newContent };
          }

          // Branch mode
          const branchRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
            input.featureId,
          );
          const fallbackBranch = input.targetBranch ?? "main";
          const baseBranch = branchRow?.value
            ? yield* getOriginalBranchEffect(gitPath, branchRow.value).pipe(
                Effect.catchAll(() => Effect.succeed(fallbackBranch)),
              )
            : fallbackBranch;

          const [oldContent, newContent] = yield* Effect.all(
            [
              getFileContentEffect(gitPath, input.filePath, baseBranch),
              getFileContentEffect(gitPath, input.filePath, "HEAD"),
            ],
            { concurrency: "unbounded" },
          );
          return { oldContent, newContent };
        }),
      );
    }),

  /** Get file content for multiple files in a single batch — used for prefetching */
  getFileContentBatch: publicProcedure
    .input(
      z.object({
        featureId: z.number(),
        filePaths: z.array(z.string()),
        mode: z.enum(["worktree", "branch"]),
        targetBranch: z.string().optional(),
        commitSha: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath || input.filePaths.length === 0) {
            return {} as Record<string, { oldContent: string; newContent: string }>;
          }

          let oldRef: string;
          let newRef: string | null;

          if (input.commitSha) {
            oldRef = `${input.commitSha}^`;
            newRef = input.commitSha;
          } else if (input.mode === "worktree") {
            oldRef = "HEAD";
            newRef = null; // working tree
          } else {
            // Branch mode: resolve base branch
            const branchRow = yield* queryOne<{ value: string }>(
              "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
              input.featureId,
            );
            const fallbackBranch = input.targetBranch ?? "main";
            oldRef = branchRow?.value
              ? yield* getOriginalBranchEffect(gitPath, branchRow.value).pipe(
                  Effect.catchAll(() => Effect.succeed(fallbackBranch)),
                )
              : fallbackBranch;
            newRef = "HEAD";
          }

          return yield* getFileContentBatchEffect(gitPath, input.filePaths, oldRef, newRef);
        }),
      );
    }),

  /** Get commit log for a feature's branch */
  getCommitLog: publicProcedure
    .input(z.object({
      featureId: z.number(),
      limit: z.number().default(20),
    }))
    .query(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return { commits: [], isOnBaseBranch: true };

          // Determine current branch name
          const branchRow = yield* queryOne<{ value: string }>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_branch'",
            input.featureId,
          );

          const branchName = branchRow?.value ?? (yield* getCurrentBranchEffect(gitPath));
          if (!branchName) return { commits: [] as CommitInfo[], isOnBaseBranch: true };

          const baseBranchResult = yield* getOriginalBranchEffect(gitPath, branchName).pipe(
            Effect.map((b) => ({ baseBranch: b, failed: false as const })),
            Effect.catchAll(() => Effect.succeed({ baseBranch: null as string | null, failed: true as const })),
          );

          if (baseBranchResult.failed || !baseBranchResult.baseBranch) {
            // Can't determine base branch — fall back to recent commits
            const commits = yield* getRecentCommitsEffect(gitPath, branchName, input.limit);
            return { commits, isOnBaseBranch: true };
          }

          const baseBranch = baseBranchResult.baseBranch;

          // On the base branch — show recent commit history
          if (branchName === baseBranch) {
            const commits = yield* getRecentCommitsEffect(gitPath, branchName, input.limit);
            return { commits, isOnBaseBranch: true };
          }

          // On a feature branch — show branch-specific commits
          const commits = yield* getCommitLogEffect(gitPath, baseBranch, branchName);
          return { commits, isOnBaseBranch: false };
        }),
      );
    }),

  removeOrphanWorktree: publicProcedure
    .input(z.object({ projectId: z.number(), worktreePath: z.string() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const project = yield* queryOne<{ path: string }>(
            "SELECT path FROM projects WHERE id = ?",
            input.projectId,
          );
          if (!project?.path) return yield* Effect.fail(new Error("Project not found"));

          return yield* removeWorktreeEffect(project.path, input.worktreePath).pipe(
            Effect.map(() => ({ success: true as const })),
            Effect.catchAll((err) =>
              Effect.succeed({
                success: false as const,
                error: err instanceof Error ? err.message : String(err),
              }),
            ),
          );
        }),
      );
    }),
});
