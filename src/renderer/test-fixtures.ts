/**
 * Mock data factories for renderer tests.
 * Each factory returns realistic data matching DB schema types.
 */

import type {
  ProjectRow,
  FeatureRow,
  PlanRow,
  PhaseRow,
  AgentMessageRow,
  AgentSessionRow,
} from "../main/db/types";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

let _projectId = 1;

export function createMockProject(overrides: Partial<ProjectRow> = {}): ProjectRow {
  const id = overrides.id ?? _projectId++;
  return {
    id,
    name: `Test Project ${id}`,
    path: `/home/user/projects/test-project-${id}`,
    created_at: "2024-01-01T00:00:00.000Z",
    model_plan: null,
    model_brainstorm: null,
    model_prd: null,
    model_execute: null,
    model_risk: null,
    model_review: null,
    model_session: null,
    model_qa: null,
    agent_autonomy: null,
    parallel_execution: null,
    branch_prefix: "feature/",
    qa_prompt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Feature
// ---------------------------------------------------------------------------

let _featureId = 1;

export function createMockFeature(overrides: Partial<FeatureRow> = {}): FeatureRow {
  const id = overrides.id ?? _featureId++;
  return {
    id,
    project_id: 1,
    title: `Test Feature ${id}`,
    type: "feature",
    status: "draft",
    created_at: "2024-01-01T00:00:00.000Z",
    model_plan: null,
    model_brainstorm: null,
    model_prd: null,
    model_execute: null,
    model_risk: null,
    model_review: null,
    model_session: null,
    model_qa: null,
    agent_autonomy: null,
    parallel_execution: null,
    prd: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

let _planId = 1;

export function createMockPlan(overrides: Partial<PlanRow> = {}): PlanRow {
  const id = overrides.id ?? _planId++;
  return {
    id,
    feature_id: 1,
    title: `Test Plan ${id}`,
    status: "pending",
    raw_markdown: null,
    summary: "A test plan summary.",
    context: "Some context about the plan.",
    clarifications: null,
    completion_conditions: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

let _phaseId = 1;

export function createMockPhase(overrides: Partial<PhaseRow> = {}): PhaseRow {
  const id = overrides.id ?? _phaseId++;
  return {
    id,
    plan_id: 1,
    step_number: 1,
    title: `Phase ${id}: Implement something`,
    status: "pending",
    complexity: 3,
    commit_message: `feat: implement phase ${id}`,
    prompt: "Implement the following feature...",
    order_index: id,
    implementation_notes: null,
    deviations: null,
    phase_type: "implementation",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentMessage
// ---------------------------------------------------------------------------

let _messageId = 1;

export function createMockAgentMessage(
  overrides: Partial<AgentMessageRow> = {},
): AgentMessageRow {
  const id = overrides.id ?? _messageId++;
  return {
    id,
    session_id: 1,
    role: "assistant",
    content: "This is a test message.",
    message_type: "text",
    tool_name: null,
    tool_use_id: null,
    parent_tool_use_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    model: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// AgentSession
// ---------------------------------------------------------------------------

let _sessionId = 1;

export function createMockAgentSession(
  overrides: Partial<AgentSessionRow> = {},
): AgentSessionRow {
  const id = overrides.id ?? _sessionId++;
  return {
    id,
    feature_id: 1,
    agent_type: "plan",
    claude_session_id: null,
    status: "completed",
    started_at: "2024-01-01T00:00:00.000Z",
    ended_at: "2024-01-01T00:05:00.000Z",
    run_id: null,
    phase_id: null,
    subprocess_id: null,
    model: "claude-opus-4-5",
    pending_questions: null,
    has_file_changes: 0,
    permission_mode: "acceptEdits",
    pending_plan_approval: null,
    pending_prd_approval: null,
    pending_permission: null,
    input_tokens: 1000,
    output_tokens: 500,
    context_window: 200000,
    was_compacted: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Diff mock factories
// ---------------------------------------------------------------------------

export interface MockDiffHunk {
  content: string;
  oldStart: number;
  newStart: number;
  oldLines: number;
  newLines: number;
  changes: { type: "normal" | "insert" | "delete"; content: string; oldLineNumber?: number; newLineNumber?: number }[];
}

export interface MockDiffFile {
  oldFileName: string;
  newFileName: string;
  hunks: MockDiffHunk[];
}

export function createMockDiffHunk(overrides: Partial<MockDiffHunk> = {}): MockDiffHunk {
  return {
    content: "@@ -1,3 +1,4 @@",
    oldStart: 1,
    newStart: 1,
    oldLines: 3,
    newLines: 4,
    changes: [
      { type: "normal", content: " line1", oldLineNumber: 1, newLineNumber: 1 },
      { type: "insert", content: "+added line", newLineNumber: 2 },
      { type: "normal", content: " line2", oldLineNumber: 2, newLineNumber: 3 },
      { type: "normal", content: " line3", oldLineNumber: 3, newLineNumber: 4 },
    ],
    ...overrides,
  };
}

export function createMockDiffFile(overrides: Partial<MockDiffFile> = {}): MockDiffFile {
  return {
    oldFileName: "src/example.ts",
    newFileName: "src/example.ts",
    hunks: [createMockDiffHunk()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset helpers (call in beforeEach to reset auto-increment counters)
// ---------------------------------------------------------------------------

export function resetMockIds() {
  _projectId = 1;
  _featureId = 1;
  _planId = 1;
  _phaseId = 1;
  _messageId = 1;
  _sessionId = 1;
}
