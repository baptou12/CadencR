import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";

// Mock SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  createSdkMcpServer: vi.fn((opts: { name: string; tools: unknown[] }) => ({
    name: opts.name,
    tools: opts.tools,
  })),
  tool: vi.fn(
    (
      name: string,
      _description: string,
      _schema: unknown,
      handler: (args: unknown) => Promise<unknown>,
    ) => ({ name, handler }),
  ),
}));

vi.mock("../../db/database");
vi.mock("../../db/query");
vi.mock("../effect-helpers", () => ({
  notifyDbUpdated: vi.fn(),
}));

import {
  readPlanTool,
  listPhasesTool,
  readPhaseTool,
  createPhaseTool,
  updatePhaseTool,
  removePhaseTool,
  createAgentDoneTool,
  createMarkPhaseDoneTool,
  createFinalizePhasesTool,
} from "./shared-tools";
import { queryOne, queryAll, queryOneValidated, queryAllValidated, execute } from "../../db/query";
import { notifyDbUpdated } from "../effect-helpers";

const mockQueryOne = vi.mocked(queryOne);
const mockQueryAll = vi.mocked(queryAll);
const mockQueryOneValidated = vi.mocked(queryOneValidated);
const mockQueryAllValidated = vi.mocked(queryAllValidated);
const mockExecute = vi.mocked(execute);
const mockNotify = vi.mocked(notifyDbUpdated);

type ToolDef = { name: string; handler: (args: any) => Promise<any> };

function getHandler(t: unknown): (args: any) => Promise<any> {
  return (t as ToolDef).handler;
}

// ---------------------------------------------------------------------------
// read_plan
// ---------------------------------------------------------------------------
describe("readPlanTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns plan markdown", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed({
      id: 1, title: "T", summary: null, context: null, clarifications: null, completion_conditions: null,
    }));
    mockQueryAllValidated.mockReturnValue(Effect.succeed([]));

    const result = await getHandler(readPlanTool)({ plan_id: 1 }) as any;
    expect(result.content[0].text).toContain("# Plan: T");
  });
});

// ---------------------------------------------------------------------------
// list_phases
// ---------------------------------------------------------------------------
describe("listPhasesTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists phases with details", async () => {
    mockQueryAll.mockReturnValue(Effect.succeed([
      { id: 1, step_number: 1, title: "Phase A", status: "pending", phase_type: "value", complexity: 3 },
    ]));

    const result = await getHandler(listPhasesTool)({ plan_id: 1 }) as any;
    expect(result.content[0].text).toContain("Phase A");
    expect(result.content[0].text).toContain("[pending]");
  });

  it("returns message when no phases found", async () => {
    mockQueryAll.mockReturnValue(Effect.succeed([]));
    const result = await getHandler(listPhasesTool)({ plan_id: 1 }) as any;
    expect(result.content[0].text).toContain("No phases found");
  });
});

// ---------------------------------------------------------------------------
// read_phase
// ---------------------------------------------------------------------------
describe("readPhaseTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns phase details", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed({
      id: 5, title: "Implement auth", plan_id: 1, step_number: 2,
      status: "pending", phase_type: "value", complexity: 4,
      commit_message: "feat: auth", order_index: 0,
      prompt: "Build auth", implementation_notes: null, deviations: null,
    }));

    const result = await getHandler(readPhaseTool)({ phase_id: 5 }) as any;
    expect(result.content[0].text).toContain("Implement auth");
    expect(result.content[0].text).toContain("Build auth");
  });

  it("returns error when phase not found", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed(null));
    const result = await getHandler(readPhaseTool)({ phase_id: 999 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("includes optional fields when present", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed({
      id: 5, title: "Phase", plan_id: 1, step_number: 1,
      status: "completed", phase_type: "value", complexity: 2,
      commit_message: null, order_index: 0,
      prompt: null, implementation_notes: "Did it", deviations: "Minor tweak",
    }));

    const result = await getHandler(readPhaseTool)({ phase_id: 5 }) as any;
    expect(result.content[0].text).toContain("Did it");
    expect(result.content[0].text).toContain("Minor tweak");
  });
});

// ---------------------------------------------------------------------------
// createPhaseTool
// ---------------------------------------------------------------------------
describe("createPhaseTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a phase and returns its id", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ max_idx: 0 }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 42 }));

    const t = createPhaseTool(10);
    const result = await getHandler(t)({ plan_id: 1, step_number: 1, title: "My Phase", prompt: "Do stuff" }) as any;

    expect(result.content[0].text).toContain("id=42");
    expect(mockNotify).toHaveBeenCalledWith("phase", 10);
  });

  it("handles null max_idx", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ max_idx: null }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 1 }));

    const t = createPhaseTool(10);
    await getHandler(t)({ plan_id: 1, step_number: 1, title: "T", prompt: "P" });
    expect(mockExecute).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updatePhaseTool
// ---------------------------------------------------------------------------
describe("updatePhaseTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates allowed fields on a draft phase", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "draft", plan_id: 1 }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = updatePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 5, title: "New Title" }) as any;

    expect(result.content[0].text).toContain("updated");
    expect(mockNotify).toHaveBeenCalledWith("phase", 10);
  });

  it("returns error when phase not found", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed(null));
    const t = updatePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 99, title: "X" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns error when phase does not belong to plan", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "draft", plan_id: 999 }));
    const t = updatePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 5, title: "X" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("does not belong");
  });

  it("returns error when phase is not draft", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "pending", plan_id: 1 }));
    const t = updatePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 5, title: "X" }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only 'draft' phases");
  });

  it("returns error when no fields to update", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "draft", plan_id: 1 }));
    const t = updatePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 5 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No fields");
  });
});

// ---------------------------------------------------------------------------
// removePhaseTool
// ---------------------------------------------------------------------------
describe("removePhaseTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes a draft phase", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "draft", plan_id: 1 }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = removePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 5 }) as any;

    expect(result.content[0].text).toContain("removed");
    expect(mockNotify).toHaveBeenCalledWith("phase", 10);
  });

  it("returns error when phase not found", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed(null));
    const t = removePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 99 }) as any;
    expect(result.isError).toBe(true);
  });

  it("returns error when phase is not draft", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "running", plan_id: 1 }));
    const t = removePhaseTool(1, 10);
    const result = await getHandler(t)({ phase_id: 5 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("only 'draft' phases");
  });
});

// ---------------------------------------------------------------------------
// createAgentDoneTool
// ---------------------------------------------------------------------------
describe("createAgentDoneTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks session completed and notifies", async () => {
    mockQueryOne
      .mockReturnValueOnce(Effect.succeed({ status: "running", agent_type: "plan", run_id: null }))
      .mockReturnValueOnce(Effect.succeed({ workflow_step: null, project_id: 1 }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = createAgentDoneTool(100, 10);
    const result = await getHandler(t)({ summary: "All done" }) as any;

    expect(result.content[0].text).toContain("completed");
    expect(mockNotify).toHaveBeenCalledWith("agent_session", 10);
  });
});

// ---------------------------------------------------------------------------
// createMarkPhaseDoneTool
// ---------------------------------------------------------------------------
describe("createMarkPhaseDoneTool", () => {
  beforeEach(() => vi.resetAllMocks());

  it("transitions phase to completed", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "running" }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = createMarkPhaseDoneTool(10);
    const result = await getHandler(t)({ phase_id: 5, implementation_notes: "Done it", deviations: "None" }) as any;

    expect(result.content[0].text).toContain("completed");
    expect(mockExecute).toHaveBeenCalledWith(
      "UPDATE phases SET status = 'completed', implementation_notes = ?, deviations = ? WHERE id = ?",
      "Done it",
      "None",
      5,
    );
    expect(mockNotify).toHaveBeenCalledWith("phase", 10);
  });

  it("uses null for optional fields when not provided", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "running" }));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = createMarkPhaseDoneTool(10);
    await getHandler(t)({ phase_id: 5 });

    expect(mockExecute).toHaveBeenCalledWith(
      "UPDATE phases SET status = 'completed', implementation_notes = ?, deviations = ? WHERE id = ?",
      null,
      null,
      5,
    );
    expect(mockNotify).toHaveBeenCalledWith("phase", 10);
  });

  it("returns error when phase not found", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed(null));
    const t = createMarkPhaseDoneTool(10);
    const result = await getHandler(t)({ phase_id: 99 }) as any;
    expect(result.isError).toBe(true);
  });

  it("returns error when phase is not running", async () => {
    mockQueryOne.mockReturnValue(Effect.succeed({ status: "pending" }));
    const t = createMarkPhaseDoneTool(10);
    const result = await getHandler(t)({ phase_id: 5 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("expected 'running'");
  });
});

// ---------------------------------------------------------------------------
// createFinalizePhasesTool
// ---------------------------------------------------------------------------
describe("createFinalizePhasesTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finalizes draft phases", async () => {
    mockQueryAll.mockReturnValue(Effect.succeed([
      { id: 5, title: "Phase A", step_number: 1 },
      { id: 6, title: "Phase B", step_number: 2 },
    ]));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 2, lastInsertRowid: 0 }));

    const t = createFinalizePhasesTool(1, 10, "phases");
    const result = await getHandler(t)({ plan_id: 1 }) as any;

    expect(result.content[0].text).toContain("Finalized 2 phases");
    expect(mockNotify).toHaveBeenCalledWith("phase", 10);
  });

  it("returns error when plan_id does not match", async () => {
    const t = createFinalizePhasesTool(1, 10, "phases");
    const result = await getHandler(t)({ plan_id: 99 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Expected plan_id 1");
  });

  it("returns error when no draft phases", async () => {
    mockQueryAll.mockReturnValue(Effect.succeed([]));
    const t = createFinalizePhasesTool(1, 10, "phases");
    const result = await getHandler(t)({ plan_id: 1 }) as any;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No draft phases");
  });

  it("uses label in success message", async () => {
    mockQueryAll.mockReturnValue(Effect.succeed([
      { id: 7, title: "Fix X", step_number: 1 },
    ]));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = createFinalizePhasesTool(1, 10, "fix phases");
    const result = await getHandler(t)({ plan_id: 1 }) as any;
    expect(result.content[0].text).toContain("Finalized 1 fix phases");
  });

  it("uses label for mitigation phases", async () => {
    mockQueryAll.mockReturnValue(Effect.succeed([
      { id: 8, title: "Mitigate Y", step_number: 1 },
    ]));
    mockExecute.mockReturnValue(Effect.succeed({ changes: 1, lastInsertRowid: 0 }));

    const t = createFinalizePhasesTool(1, 10, "mitigation phases");
    const result = await getHandler(t)({ plan_id: 1 }) as any;
    expect(result.content[0].text).toContain("Finalized 1 mitigation phases");
  });
});
