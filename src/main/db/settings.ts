import { getDatabase } from "./database";
import type { SettingRow } from "./types";

/** Column names that exist on both projects and features tables. */
const SHARED_COLUMNS = new Set([
  "model_plan",
  "model_brainstorm",
  "model_execute",
  "model_risk",
  "model_review",
  "model_session",
  "model_qa",
  "model_prd",
  "agent_autonomy",
  "parallel_execution",
]);

/** Column names that only exist on the projects table. */
const PROJECT_ONLY_COLUMNS = new Set(["branch_prefix", "qa_prompt"]);

/**
 * Resolve a setting using the cascade: feature column → project column → global EAV → default.
 *
 * For columns in SHARED_COLUMNS the cascade is feature → project → global → default.
 * For columns in PROJECT_ONLY_COLUMNS the cascade is project → global → default.
 * For anything else it falls through to the global settings EAV table → default.
 */
export function resolveSetting(
  column: string,
  opts: { featureId?: number; projectId?: number; defaultValue?: string },
): string | null {
  const db = getDatabase();
  const defaultValue = opts.defaultValue ?? null;

  // 1. Feature-level (real column)
  if (opts.featureId != null && SHARED_COLUMNS.has(column)) {
    const row = db
      .prepare(`SELECT "${column}" as v FROM features WHERE id = ?`)
      .get(opts.featureId) as { v: string | null } | undefined;
    if (row?.v) return row.v;
  }

  // 2. Project-level (real column)
  if (opts.projectId != null && (SHARED_COLUMNS.has(column) || PROJECT_ONLY_COLUMNS.has(column))) {
    const row = db
      .prepare(`SELECT "${column}" as v FROM projects WHERE id = ?`)
      .get(opts.projectId) as { v: string | null } | undefined;
    if (row?.v) return row.v;
  }

  // 3. Global settings EAV table
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(column) as SettingRow | undefined;
  if (row?.value) return row.value;

  return defaultValue;
}
