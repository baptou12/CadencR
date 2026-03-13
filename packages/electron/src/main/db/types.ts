/**
 * Database row types — centralized for reuse across the codebase.
 *
 * The Effect Schemas in `src/main/effect/schemas/db-schemas.ts` are the
 * source of truth. Types here are derived from those schemas to keep them
 * in sync. The manual interfaces have been replaced by schema-derived types.
 */

import type {
  SettingRowSchema,
  ProjectRowSchema,
  ProjectSettingRowSchema,
  FeatureTypeSchema,
  FeatureRowSchema,
  FeatureSettingRowSchema,
  PlanRowSchema,
  PhaseRowSchema,
  AgentSessionRowSchema,
  AgentMessageRowSchema,
  CountRowSchema,
} from "../effect/schemas/db-schemas.js";

// -- settings --

export type SettingRow = typeof SettingRowSchema.Type;

// -- projects --

export type ProjectRow = typeof ProjectRowSchema.Type;

export type ProjectSettingRow = typeof ProjectSettingRowSchema.Type;

// -- features --

export type FeatureType = typeof FeatureTypeSchema.Type;

export type FeatureRow = typeof FeatureRowSchema.Type;

export type FeatureSettingRow = typeof FeatureSettingRowSchema.Type;

// -- plans & phases --

export type PlanRow = typeof PlanRowSchema.Type;

export type PhaseRow = typeof PhaseRowSchema.Type;

// -- agent sessions & messages --

export type AgentSessionRow = typeof AgentSessionRowSchema.Type;

export type AgentMessageRow = typeof AgentMessageRowSchema.Type;

// -- composite types --

export interface PlanWithPhases extends PlanRow {
  phases: PhaseRow[];
}

// -- utility pick types for partial selects --

/** For `SELECT COUNT(*) as count` queries */
export type CountRow = typeof CountRowSchema.Type;
