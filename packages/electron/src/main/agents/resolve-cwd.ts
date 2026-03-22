/**
 * Resolve the working directory for an agent, preferring worktree path over project path.
 * Shared between router.ts and execute-agent.ts.
 */

import fs from "node:fs";
import { Effect } from "effect";
import { queryOne } from "../db/query";
import { DatabaseError } from "../effect/errors";
import type { SettingRow, ProjectRow } from "../db/types";

export function resolveAgentCwd(
  featureId: number,
  projectId: number,
): Effect.Effect<{ cwd: string; worktreePath?: string }, DatabaseError | Error> {
  return Effect.gen(function* () {
    // Session-type features never use worktrees
    const feature = yield* queryOne<{ type: string }>(
      "SELECT type FROM features WHERE id = ?",
      featureId,
    );

    const wtRow =
      feature?.type === "ws-session"
        ? null
        : yield* queryOne<SettingRow>(
            "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
            featureId,
          );

    const project = yield* queryOne<Pick<ProjectRow, "path">>(
      "SELECT path FROM projects WHERE id = ?",
      projectId,
    );

    if (!wtRow) {
      const errorRow = yield* queryOne<SettingRow>(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_error'",
        featureId,
      );

      if (errorRow) {
        console.warn(
          `Worktree not available for feature ${featureId}, falling back to project path. Worktree error: ${errorRow.value}`,
        );
      }
    }

    const cwd = wtRow?.value ?? project?.path;
    if (!cwd) {
      return yield* Effect.fail(new Error("No working directory found for this feature"));
    }

    if (!fs.existsSync(cwd)) {
      return yield* Effect.fail(
        new Error(
          `Agent working directory does not exist: ${cwd}. The worktree may not have been created yet or was removed.`,
        ),
      );
    }

    return { cwd, worktreePath: wtRow?.value ?? undefined };
  });
}
