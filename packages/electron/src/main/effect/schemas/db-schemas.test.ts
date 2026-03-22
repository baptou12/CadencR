import { describe, it, expect } from "vitest";
import { Effect, Schema } from "effect";
import {
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
} from "./db-schemas.js";

/** Decode a value against a schema, returning success or throwing */
function decode<T, I>(schema: Schema.Schema<T, I>, value: unknown): T {
  return Effect.runSync(Schema.decodeUnknown(schema)(value));
}

/** Assert that decoding fails with a ParseError */
function expectParseError<T, I>(schema: Schema.Schema<T, I>, value: unknown): void {
  expect(() => decode(schema, value)).toThrow();
}

// ---------------------------------------------------------------------------
// SettingRowSchema
// ---------------------------------------------------------------------------

describe("SettingRowSchema", () => {
  it("accepts valid data", () => {
    const result = decode(SettingRowSchema, { key: "theme", value: "dark" });
    expect(result).toEqual({ key: "theme", value: "dark" });
  });

  it("rejects missing key", () => {
    expectParseError(SettingRowSchema, { value: "dark" });
  });

  it("rejects non-string value", () => {
    expectParseError(SettingRowSchema, { key: "theme", value: 123 });
  });

  it("rejects non-object", () => {
    expectParseError(SettingRowSchema, "not-an-object");
  });
});

// ---------------------------------------------------------------------------
// ProjectRowSchema
// ---------------------------------------------------------------------------

describe("ProjectRowSchema", () => {
  const validProject: typeof ProjectRowSchema.Type = {
    id: 1,
    name: "My Project",
    path: "/home/user/project",
    created_at: "2024-01-01T00:00:00Z",
    model_plan: null,
    model_execute: "claude-3-opus",
    model_risk: null,
    model_review: null,
    model_session: null,
    model_qa: null,
    model_prd: null,
    agent_autonomy: null,
    parallel_execution: null,
    branch_prefix: null,
    qa_prompt: null,
  };

  it("accepts a valid project row", () => {
    const result = decode(ProjectRowSchema, validProject);
    expect(result.id).toBe(1);
    expect(result.name).toBe("My Project");
    expect(result.model_execute).toBe("claude-3-opus");
    expect(result.model_plan).toBeNull();
  });

  it("accepts all nullable fields as null", () => {
    const allNull = { ...validProject, model_execute: null };
    const result = decode(ProjectRowSchema, allNull);
    expect(result.model_execute).toBeNull();
  });

  it("rejects missing required field name", () => {
    const { name: _name, ...withoutName } = validProject;
    expectParseError(ProjectRowSchema, withoutName);
  });

  it("rejects non-number id", () => {
    expectParseError(ProjectRowSchema, { ...validProject, id: "not-a-number" });
  });

  it("rejects non-null non-string model_plan", () => {
    expectParseError(ProjectRowSchema, { ...validProject, model_plan: 42 });
  });
});

// ---------------------------------------------------------------------------
// ProjectSettingRowSchema
// ---------------------------------------------------------------------------

describe("ProjectSettingRowSchema", () => {
  it("accepts valid data", () => {
    const result = decode(ProjectSettingRowSchema, { id: 1, project_id: 2, key: "theme", value: "dark" });
    expect(result).toEqual({ id: 1, project_id: 2, key: "theme", value: "dark" });
  });

  it("rejects missing project_id", () => {
    expectParseError(ProjectSettingRowSchema, { id: 1, key: "theme", value: "dark" });
  });
});

// ---------------------------------------------------------------------------
// FeatureTypeSchema
// ---------------------------------------------------------------------------

describe("FeatureTypeSchema", () => {
  it("accepts 'ws-feature'", () => {
    expect(decode(FeatureTypeSchema, "ws-feature")).toBe("ws-feature");
  });

  it("accepts 'ws-session'", () => {
    expect(decode(FeatureTypeSchema, "ws-session")).toBe("ws-session");
  });

  it("rejects legacy 'feature' type", () => {
    expectParseError(FeatureTypeSchema, "feature");
  });

  it("rejects legacy 'session' type", () => {
    expectParseError(FeatureTypeSchema, "session");
  });

  it("rejects unknown literal", () => {
    expectParseError(FeatureTypeSchema, "unknown");
  });

  it("rejects non-string", () => {
    expectParseError(FeatureTypeSchema, 42);
  });
});

// ---------------------------------------------------------------------------
// FeatureRowSchema
// ---------------------------------------------------------------------------

describe("FeatureRowSchema", () => {
  const validFeature: typeof FeatureRowSchema.Type = {
    id: 10,
    project_id: 1,
    title: "My Feature",
    type: "ws-feature",
    status: "in-progress",
    created_at: "2024-06-01T00:00:00Z",
    model_plan: null,
    model_execute: null,
    model_risk: null,
    model_review: null,
    model_session: null,
    model_qa: null,
    model_prd: null,
    agent_autonomy: null,
    parallel_execution: null,
    prd: "## PRD content",
    workflow_step: null,
    workflow_config: null,
  };

  it("accepts a valid feature row", () => {
    const result = decode(FeatureRowSchema, validFeature);
    expect(result.id).toBe(10);
    expect(result.type).toBe("ws-feature");
  });

  it("accepts type = 'ws-session'", () => {
    const result = decode(FeatureRowSchema, { ...validFeature, type: "ws-session" });
    expect(result.type).toBe("ws-session");
  });

  it("rejects invalid type", () => {
    expectParseError(FeatureRowSchema, { ...validFeature, type: "bugfix" });
  });

  it("rejects missing title", () => {
    const { title: _t, ...withoutTitle } = validFeature;
    expectParseError(FeatureRowSchema, withoutTitle);
  });

  it("catches type mismatch that 'as T' would miss", () => {
    // 'as T' would blindly cast this; Schema catches the wrong id type
    expectParseError(FeatureRowSchema, { ...validFeature, id: "not-a-number" });
  });
});

// ---------------------------------------------------------------------------
// FeatureSettingRowSchema
// ---------------------------------------------------------------------------

describe("FeatureSettingRowSchema", () => {
  it("accepts valid data", () => {
    const result = decode(FeatureSettingRowSchema, { id: 1, feature_id: 5, key: "k", value: "v" });
    expect(result).toEqual({ id: 1, feature_id: 5, key: "k", value: "v" });
  });

  it("rejects missing feature_id", () => {
    expectParseError(FeatureSettingRowSchema, { id: 1, key: "k", value: "v" });
  });
});

// ---------------------------------------------------------------------------
// PlanRowSchema
// ---------------------------------------------------------------------------

describe("PlanRowSchema", () => {
  const validPlan: typeof PlanRowSchema.Type = {
    id: 100,
    feature_id: 10,
    title: "Implementation Plan",
    status: "active",
    raw_markdown: "# Plan",
    summary: "Summary text",
    context: null,
    clarifications: null,
    completion_conditions: null,
    created_at: "2024-06-01T00:00:00Z",
    updated_at: "2024-06-02T00:00:00Z",
  };

  it("accepts a valid plan row", () => {
    const result = decode(PlanRowSchema, validPlan);
    expect(result.id).toBe(100);
    expect(result.status).toBe("active");
  });

  it("accepts 'approved' status", () => {
    const result = decode(PlanRowSchema, { ...validPlan, status: "approved" });
    expect(result.status).toBe("approved");
  });

  it("accepts all nullable fields as null", () => {
    const allNull = { ...validPlan, raw_markdown: null, summary: null };
    const result = decode(PlanRowSchema, allNull);
    expect(result.raw_markdown).toBeNull();
  });

  it("rejects missing feature_id", () => {
    const { feature_id: _f, ...without } = validPlan;
    expectParseError(PlanRowSchema, without);
  });
});

// ---------------------------------------------------------------------------
// PhaseRowSchema
// ---------------------------------------------------------------------------

describe("PhaseRowSchema", () => {
  const validPhase: typeof PhaseRowSchema.Type = {
    id: 200,
    plan_id: 100,
    step_number: 1,
    title: "Setup DB",
    status: "pending",
    complexity: 3,
    commit_message: "feat: setup db",
    prompt: "Do the thing",
    order_index: 0,
    implementation_notes: null,
    deviations: null,
    phase_type: "value",
  };

  it("accepts a valid phase row", () => {
    const result = decode(PhaseRowSchema, validPhase);
    expect(result.id).toBe(200);
    expect(result.phase_type).toBe("value");
  });

  it("accepts implementation_notes as a string", () => {
    const result = decode(PhaseRowSchema, { ...validPhase, implementation_notes: "Implemented X" });
    expect(result.implementation_notes).toBe("Implemented X");
  });

  it("accepts null commit_message and prompt", () => {
    const result = decode(PhaseRowSchema, { ...validPhase, commit_message: null, prompt: null });
    expect(result.commit_message).toBeNull();
    expect(result.prompt).toBeNull();
  });

  it("rejects missing commit_message", () => {
    const { commit_message: _cm, ...without } = validPhase;
    expectParseError(PhaseRowSchema, without);
  });

  it("rejects non-number step_number", () => {
    expectParseError(PhaseRowSchema, { ...validPhase, step_number: "one" });
  });

  it("catches type mismatch that 'as T' would miss (complexity as string)", () => {
    expectParseError(PhaseRowSchema, { ...validPhase, complexity: "3" });
  });
});

// ---------------------------------------------------------------------------
// AgentSessionRowSchema
// ---------------------------------------------------------------------------

describe("AgentSessionRowSchema", () => {
  const validSession: typeof AgentSessionRowSchema.Type = {
    id: 1,
    feature_id: 10,
    agent_type: "execute",
    claude_session_id: null,
    status: "running",
    started_at: "2024-06-01T10:00:00Z",
    ended_at: null,
    run_id: null,
    phase_id: 200,
    subprocess_id: "abc-123",
    model: "claude-3-5-sonnet",
    pending_questions: null,
    has_file_changes: 0,
    permission_mode: null,
    pending_plan_approval: null,
    pending_prd_approval: null,
    pending_permission: null,
    input_tokens: 1000,
    output_tokens: 500,
    context_window: 8192,
    was_compacted: 0,
  };

  it("accepts a valid agent session row", () => {
    const result = decode(AgentSessionRowSchema, validSession);
    expect(result.id).toBe(1);
    expect(result.agent_type).toBe("execute");
    expect(result.has_file_changes).toBe(0);
  });

  it("accepts nullable phase_id and run_id as null", () => {
    const result = decode(AgentSessionRowSchema, { ...validSession, phase_id: null, run_id: null });
    expect(result.phase_id).toBeNull();
    expect(result.run_id).toBeNull();
  });

  it("rejects missing feature_id", () => {
    const { feature_id: _f, ...without } = validSession;
    expectParseError(AgentSessionRowSchema, without);
  });

  it("rejects non-number has_file_changes", () => {
    expectParseError(AgentSessionRowSchema, { ...validSession, has_file_changes: true });
  });
});

// ---------------------------------------------------------------------------
// AgentMessageRowSchema
// ---------------------------------------------------------------------------

describe("AgentMessageRowSchema", () => {
  const validMessage: typeof AgentMessageRowSchema.Type = {
    id: 1,
    session_id: 1,
    role: "assistant",
    content: "Hello!",
    message_type: "text",
    tool_name: null,
    tool_use_id: null,
    parent_tool_use_id: null,
    created_at: "2024-06-01T10:00:00Z",
    model: "claude-3-5-sonnet",
  };

  it("accepts a valid agent message row", () => {
    const result = decode(AgentMessageRowSchema, validMessage);
    expect(result.id).toBe(1);
    expect(result.role).toBe("assistant");
  });

  it("accepts non-null tool_name", () => {
    const result = decode(AgentMessageRowSchema, { ...validMessage, tool_name: "bash", tool_use_id: "xyz" });
    expect(result.tool_name).toBe("bash");
  });

  it("rejects missing content", () => {
    const { content: _c, ...without } = validMessage;
    expectParseError(AgentMessageRowSchema, without);
  });

  it("rejects non-string role", () => {
    expectParseError(AgentMessageRowSchema, { ...validMessage, role: 42 });
  });
});

// ---------------------------------------------------------------------------
// CountRowSchema
// ---------------------------------------------------------------------------

describe("CountRowSchema", () => {
  it("accepts a valid count row", () => {
    const result = decode(CountRowSchema, { count: 42 });
    expect(result.count).toBe(42);
  });

  it("accepts count = 0", () => {
    const result = decode(CountRowSchema, { count: 0 });
    expect(result.count).toBe(0);
  });

  it("rejects non-number count", () => {
    expectParseError(CountRowSchema, { count: "42" });
  });

  it("rejects missing count", () => {
    expectParseError(CountRowSchema, {});
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: Schema.decodeUnknown catches what 'as T' would miss
// ---------------------------------------------------------------------------

describe("Schema.decodeUnknown catches type mismatches that 'as T' would miss", () => {
  it("PhaseRowSchema rejects a row with wrong field types from DB", () => {
    // Simulate a bug where SQLite returns step_number as string
    const badRow = {
      id: 1,
      plan_id: 100,
      step_number: "1", // string instead of number
      title: "Phase",
      status: "pending",
      complexity: 3,
      commit_message: "feat: something",
      prompt: "Do something",
      order_index: 0,
      implementation_notes: null,
      deviations: null,
      phase_type: "value",
    };
    expectParseError(PhaseRowSchema, badRow);
  });

  it("FeatureRowSchema rejects a row with invalid type field from DB", () => {
    // Simulate a bug where type has an unexpected value
    const badRow = {
      id: 1,
      project_id: 1,
      title: "Feature",
      type: "task", // not 'feature' | 'session'
      status: "draft",
      created_at: "2024-01-01",
      model_plan: null,
      model_execute: null,
      model_risk: null,
      model_review: null,
      model_session: null,
      model_qa: null,
      model_prd: null,
      agent_autonomy: null,
      parallel_execution: null,
      prd: null,
      workflow_step: null,
      workflow_config: null,
    };
    expectParseError(FeatureRowSchema, badRow);
  });
});
