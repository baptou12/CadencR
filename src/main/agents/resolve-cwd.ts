/**
 * Resolve the working directory for an agent, preferring worktree path over project path.
 * Shared between router.ts and execute-agent.ts.
 */

import fs from "node:fs";
import { getDatabase } from "../db/database";
import type { SettingRow, ProjectRow } from "../db/types";

export async function resolveAgentCwd(featureId: number, projectId: number): Promise<{ cwd: string; worktreePath?: string }> {
  const db = getDatabase();

  // Session-type features never use worktrees
  const feature = db
    .prepare("SELECT type FROM features WHERE id = ?")
    .get(featureId) as { type: string } | undefined;

  const wtRow = feature?.type === "session"
    ? undefined
    : db
        .prepare(
          "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_path'",
        )
        .get(featureId) as SettingRow | undefined;

  const project = db
    .prepare("SELECT path FROM projects WHERE id = ?")
    .get(projectId) as Pick<ProjectRow, "path"> | undefined;

  if (!wtRow) {
    const errorRow = db
      .prepare(
        "SELECT value FROM feature_settings WHERE feature_id = ? AND key = 'worktree_error'",
      )
      .get(featureId) as SettingRow | undefined;

    if (errorRow) {
      console.warn(
        `Worktree not available for feature ${featureId}, falling back to project path. Worktree error: ${errorRow.value}`,
      );
    }
  }

  const cwd = wtRow?.value ?? project?.path;
  if (!cwd) throw new Error("No working directory found for this feature");
  try {
    await fs.promises.access(cwd);
  } catch {
    throw new Error(
      `Agent working directory does not exist: ${cwd}. The worktree may not have been created yet or was removed.`,
    );
  }
  return { cwd, worktreePath: wtRow?.value };
}
