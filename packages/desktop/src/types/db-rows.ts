/**
 * Row types matching the Rust backend DB schema.
 * Used by renderer test fixtures and components.
 */

export interface ProjectRow {
  id: number;
  name: string;
  path: string;
  created_at: string;
  model_session: string | null;
  branch_prefix: string;
}

export interface FeatureRow {
  id: number;
  project_id: number;
  title: string;
  type: string;
  created_at: string;
  model_session: string | null;
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
  runtime_session_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  subprocess_id: string | null;
  model: string;
  pending_questions: string | null;
  has_file_changes: number;
  permission_mode: string;
  pending_permission: string | null;
  input_tokens: number;
  output_tokens: number;
  context_window: number | null;
  was_compacted: number;
}
