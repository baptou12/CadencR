/**
 * Resume in-progress features after database initialization.
 * Extracted from database.ts to break circular dependency.
 */

import { Effect } from "effect";
import { getDatabase } from "../db/database";
import { processNextPhase } from "./execute-agent";
import { resolveAgentCwd } from "./resolve-cwd";

/**
 * Resume any features that were in-progress when the app last closed.
 * Should be called after app ready and database initialization.
 */
export function resumeInProgressFeatures(): void {
  void (async () => {
    try {
      const db = getDatabase();
      const inProgress = db.prepare("SELECT id, project_id FROM features WHERE status = 'in-progress'").all() as { id: number; project_id: number }[];
      for (const feat of inProgress) {
        try {
          const { cwd, worktreePath } = Effect.runSync(resolveAgentCwd(feat.id, feat.project_id));
          processNextPhase({ featureId: feat.id, projectId: feat.project_id, cwd, worktreePath });
        } catch { /* individual feature recovery failure is ok */ }
      }
    } catch {
      // Silently ignore — agent module may not be loaded yet
    }
  })();
}
