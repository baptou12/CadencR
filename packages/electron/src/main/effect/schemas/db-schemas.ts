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

export const FeatureTypeSchema = Schema.Literal("feature", "session", "ws-session");

export const FeatureStatusSchema = Schema.Literal("draft", "planned", "in-progress", "done", "archived");

export const FeatureRowSchema = Schema.Struct({
  id: Schema.Number,
  project_id: Schema.Number,
  title: Schema.String,
  type: FeatureTypeSchema,
  status: FeatureStatusSchema,
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

export const PlanStatusSchema = Schema.Literal("draft", "active", "pending", "approved");

export const PlanRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  title: Schema.String,
  status: PlanStatusSchema,
  raw_markdown: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  context: Schema.NullOr(Schema.String),
  clarifications: Schema.NullOr(Schema.String),
  completion_conditions: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});

export const PhaseStatusSchema = Schema.Literal("draft", "pending", "running", "completed", "error", "done");

export const PhaseTypeSchema = Schema.Literal("setup", "value", "qa", "implementation");

export const PhaseRowSchema = Schema.Struct({
  id: Schema.Number,
  plan_id: Schema.Number,
  step_number: Schema.Number,
  title: Schema.String,
  status: PhaseStatusSchema,
  complexity: Schema.Number,
  commit_message: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  order_index: Schema.Number,
  implementation_notes: Schema.NullOr(Schema.String),
  deviations: Schema.NullOr(Schema.String),
  phase_type: PhaseTypeSchema,
});

// ---------------------------------------------------------------------------
// Agent Sessions & Messages
// ---------------------------------------------------------------------------

export const AgentTypeSchema = Schema.Literal(
  "plan", "prd", "execute", "risk", "review", "session", "qa", "review-fixer", "retro",
);

export const AgentSessionStatusSchema = Schema.Literal("running", "waiting", "paused", "completed", "error");

export const AgentSessionRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  agent_type: AgentTypeSchema,
  claude_session_id: Schema.NullOr(Schema.String),
  status: AgentSessionStatusSchema,
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

export const MessageRoleSchema = Schema.Literal("user", "assistant", "system", "tool");

export const MessageTypeSchema = Schema.Literal(
  "text", "text_delta", "thinking", "thinking_delta",
  "tool_use", "tool_call", "tool_result", "tool_error",
  "user_message", "error",
  "clear_divider", "compact_divider",
  "risk_report", "review_report", "qa_report", "retro_report",
);

export const AgentMessageRowSchema = Schema.Struct({
  id: Schema.Number,
  session_id: Schema.Number,
  role: MessageRoleSchema,
  content: Schema.String,
  message_type: MessageTypeSchema,
  tool_name: Schema.NullOr(Schema.String),
  tool_use_id: Schema.NullOr(Schema.String),
  parent_tool_use_id: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  model: Schema.NullOr(Schema.String),
});

// ---------------------------------------------------------------------------
// Diff Comments
// ---------------------------------------------------------------------------

export const DiffCommentRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  file_path: Schema.String,
  line_number: Schema.Number,
  side: Schema.Literal("old", "new"),
  content: Schema.String,
  status: Schema.Literal("pending", "sent", "resolved"),
  created_at: Schema.String,
});

// ---------------------------------------------------------------------------
// Diff Viewed Files
// ---------------------------------------------------------------------------

export const DiffViewedRowSchema = Schema.Struct({
  id: Schema.Number,
  feature_id: Schema.Number,
  file_path: Schema.String,
  blob_sha: Schema.String,
  viewed_at: Schema.String,
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export const CountRowSchema = Schema.Struct({
  count: Schema.Number,
});
