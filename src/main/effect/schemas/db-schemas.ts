/**
 * Effect Schemas for all database row types.
 *
 * These schemas serve as the source of truth for runtime validation of SQL
 * query results. TypeScript types in `src/main/db/types.ts` are derived from
 * these schemas to keep them in sync.
 */

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const SettingRowSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String,
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const ProjectRowSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  path: Schema.String,
  created_at: Schema.String,
  model_plan: Schema.NullOr(Schema.String),
  model_execute: Schema.NullOr(Schema.String),
  model_risk: Schema.NullOr(Schema.String),
  model_review: Schema.NullOr(Schema.String),
  model_session: Schema.NullOr(Schema.String),
  model_qa: Schema.NullOr(Schema.String),
  model_prd: Schema.NullOr(Schema.String),
  agent_autonomy: Schema.NullOr(Schema.String),
  parallel_execution: Schema.NullOr(Schema.String),
  branch_prefix: Schema.NullOr(Schema.String),
  qa_prompt: Schema.NullOr(Schema.String),
});

export const ProjectSettingRowSchema = Schema.Struct({
  id: Schema.Number,
  project_id: Schema.Number,
  key: Schema.String,
  value: Schema.String,
});

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

export const FeatureTypeSchema = Schema.Literal("feature", "session");

export const FeatureRowSchema = Schema.Struct({
  id: Schema.Number,
  project_id: Schema.Number,
  title: Schema.String,
  type: FeatureTypeSchema,
  /** Possible values: "draft" | "planned" | "in-progress" | "done" | "archived" */
  status: Schema.String,
  created_at: Schema.String,
  model_plan: Schema.NullOr(Schema.String),
  model_execute: Schema.NullOr(Schema.String),
  model_risk: Schema.NullOr(Schema.String),
  model_review: Schema.NullOr(Schema.String),
  model_session: Schema.NullOr(Schema.String),
  model_qa: Schema.NullOr(Schema.String),
  model_prd: Schema.NullOr(Schema.String),
  agent_autonomy: Schema.NullOr(Schema.String),
  parallel_execution: Schema.NullOr(Schema.String),
  prd: Schema.NullOr(Schema.String),
  workflow_step: Schema.NullOr(Schema.String),
  workflow_config: Schema.NullOr(Schema.String),
});

export const FeatureSettingRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  key: Schema.String,
  value: Schema.String,
});

// ---------------------------------------------------------------------------
// Plans & Phases
// ---------------------------------------------------------------------------

export const PlanRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  title: Schema.String,
  status: Schema.String,
  raw_markdown: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  context: Schema.NullOr(Schema.String),
  clarifications: Schema.NullOr(Schema.String),
  completion_conditions: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});

export const PhaseRowSchema = Schema.Struct({
  id: Schema.Number,
  plan_id: Schema.Number,
  step_number: Schema.Number,
  title: Schema.String,
  status: Schema.String,
  complexity: Schema.Number,
  commit_message: Schema.String,
  prompt: Schema.String,
  order_index: Schema.Number,
  implementation_notes: Schema.NullOr(Schema.String),
  deviations: Schema.NullOr(Schema.String),
  phase_type: Schema.String,
});

// ---------------------------------------------------------------------------
// Agent Sessions & Messages
// ---------------------------------------------------------------------------

export const AgentSessionRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  agent_type: Schema.String,
  claude_session_id: Schema.NullOr(Schema.String),
  status: Schema.String,
  started_at: Schema.NullOr(Schema.String),
  ended_at: Schema.NullOr(Schema.String),
  run_id: Schema.NullOr(Schema.Number),
  phase_id: Schema.NullOr(Schema.Number),
  subprocess_id: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  pending_questions: Schema.NullOr(Schema.String),
  has_file_changes: Schema.Number,
  permission_mode: Schema.NullOr(Schema.String),
  pending_plan_approval: Schema.NullOr(Schema.String),
  pending_prd_approval: Schema.NullOr(Schema.String),
  pending_permission: Schema.NullOr(Schema.String),
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
  context_window: Schema.Number,
  was_compacted: Schema.Number,
});

export const AgentMessageRowSchema = Schema.Struct({
  id: Schema.Number,
  session_id: Schema.Number,
  role: Schema.String,
  content: Schema.String,
  message_type: Schema.String,
  tool_name: Schema.NullOr(Schema.String),
  tool_use_id: Schema.NullOr(Schema.String),
  parent_tool_use_id: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  model: Schema.NullOr(Schema.String),
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export const CountRowSchema = Schema.Struct({
  count: Schema.Number,
});
