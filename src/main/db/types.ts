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
}

export interface ProjectSettingRow {
  id: number;
  project_id: number;
  key: string;
  value: string;
}

// -- features --

export interface FeatureRow {
  id: number;
  project_id: number;
  title: string;
  status: string;
  created_at: string;
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
}

export interface AgentMessageRow {
  id: number;
  session_id: number;
  role: string;
  content: string;
  message_type: string;
  tool_name: string | null;
  created_at: string;
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
