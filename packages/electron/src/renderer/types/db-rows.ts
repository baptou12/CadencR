/**
 * Row types matching the Rust backend DB schema.
 * Used by renderer test fixtures and components.
 */

export interface ProjectRow {
  id: number;
  name: string;
  path: string;
  created_at: string;
  model_plan: string | null;
  model_prd: string | null;
  model_execute: string | null;
  model_risk: string | null;
  model_review: string | null;
  model_session: string | null;
  model_qa: string | null;
  agent_autonomy: string | null;
  parallel_execution: number | null;
  branch_prefix: string;
  qa_prompt: string | null;
}

export interface FeatureRow {
  id: number;
  project_id: number;
  title: string;
  type: string;
  status: string;
  created_at: string;
  model_plan: string | null;
  model_prd: string | null;
  model_execute: string | null;
  model_risk: string | null;
  model_review: string | null;
  model_session: string | null;
  model_qa: string | null;
  agent_autonomy: string | null;
  parallel_execution: number | null;
  prd: string | null;
  workflow_step: string | null;
  workflow_config: string | null;
}

export interface PlanRow {
  id: number;
  feature_id: number;
  title: string;
  status: string;
  raw_markdown: string | null;
  summary: string;
  context: string;
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

export interface AgentSessionRow {
  id: number;
  feature_id: number;
  agent_type: string;
  claude_session_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  run_id: string | null;
  phase_id: number | null;
  subprocess_id: string | null;
  model: string;
  pending_questions: string | null;
  has_file_changes: number;
  permission_mode: string;
  pending_plan_approval: string | null;
  pending_prd_approval: string | null;
  pending_permission: string | null;
  input_tokens: number;
  output_tokens: number;
  context_window: number;
  was_compacted: number;
}
