/** Database row types — centralized for reuse across the codebase */

// -- settings --

export interface SettingRow {
  key: string;
  value: string;
}

// -- projects --

export interface ProjectRow {
  id: number;
  name: string;
  path: string;
  created_at: string;
  model_plan: string | null;
  model_execute: string | null;
  model_risk: string | null;
  model_review: string | null;
  model_session: string | null;
  model_qa: string | null;
  model_prd: string | null;
  agent_autonomy: string | null;
  parallel_execution: string | null;
  branch_prefix: string | null;
  qa_prompt: string | null;
}

export interface ProjectSettingRow {
  id: number;
  project_id: number;
  key: string;
  value: string;
}

// -- features --

export type FeatureType = "feature" | "session";

export interface FeatureRow {
  id: number;
  project_id: number;
  title: string;
  type: FeatureType;
  /** Possible values: "draft" | "planned" | "in-progress" | "review" | "done" | "archived" */
  status: string;
  created_at: string;
  model_plan: string | null;
  model_execute: string | null;
  model_risk: string | null;
  model_review: string | null;
  model_session: string | null;
  model_qa: string | null;
  model_prd: string | null;
  agent_autonomy: string | null;
  parallel_execution: string | null;
  prd: string | null;
  workflow_step: string | null;
  workflow_config: string | null;
}

export interface FeatureSettingRow {
  id: number;
  feature_id: number;
  key: string;
  value: string;
}

// -- plans & phases --

export interface PlanRow {
  id: number;
  feature_id: number;
  title: string;
  status: string;
  raw_markdown: string | null;
  summary: string | null;
  context: string | null;
  clarifications: string | null;
  completion_conditions: string | null;
  created_at: string;
  updated_at: string;
}

export interface PhaseRow {
  id: number;
  plan_id: number;
  step_number: number;
  title: string;
  status: string;
  complexity: number;
  commit_message: string;
  prompt: string;
  order_index: number;
  implementation_notes: string | null;
  deviations: string | null;
  phase_type: string;
}

// -- agent sessions & messages --

export interface AgentSessionRow {
  id: number;
  feature_id: number;
  agent_type: string;
  claude_session_id: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  run_id: number | null;
  phase_id: number | null;
  subprocess_id: string | null;
  model: string | null;
  pending_questions: string | null;
  has_file_changes: number;
  permission_mode: string | null;
  pending_plan_approval: string | null;
  pending_prd_approval: string | null;
  pending_permission: string | null;
  input_tokens: number;
  output_tokens: number;
  context_window: number;
  was_compacted: number;
}

export interface AgentMessageRow {
  id: number;
  session_id: number;
  role: string;
  content: string;
  message_type: string;
  tool_name: string | null;
  tool_use_id: string | null;
  parent_tool_use_id: string | null;
  created_at: string;
  model: string | null;
}

// -- composite types --

export interface PlanWithPhases extends PlanRow {
  phases: PhaseRow[];
}

// -- utility pick types for partial selects --

/** For `SELECT COUNT(*) as count` queries */
export interface CountRow {
  count: number;
}
