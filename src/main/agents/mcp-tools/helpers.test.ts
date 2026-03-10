import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";

vi.mock("../../db/query");
vi.mock("../../effect/runtime", () => ({
  AppRuntime: {
    runPromise: (effect: Effect.Effect<unknown, unknown>) => Effect.runPromise(effect),
  },
}));

import { renderPlanMarkdown, textResult, errorResult } from "./helpers";
import { queryOneValidated, queryAllValidated } from "../../db/query";

const mockQueryOneValidated = vi.mocked(queryOneValidated);
const mockQueryAllValidated = vi.mocked(queryAllValidated);

// ---------------------------------------------------------------------------
// textResult / errorResult
// ---------------------------------------------------------------------------
describe("textResult", () => {
  it("wraps text in content array", () => {
    const r = textResult("hello");
    expect(r).toEqual({ content: [{ type: "text", text: "hello" }] });
  });
});

describe("errorResult", () => {
  it("wraps text with isError flag", () => {
    const r = errorResult("bad");
    expect(r).toEqual({ content: [{ type: "text", text: "bad" }], isError: true });
  });
});

// ---------------------------------------------------------------------------
// renderPlanMarkdown
// ---------------------------------------------------------------------------
describe("renderPlanMarkdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'Plan not found.' when plan does not exist", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed(null));
    expect(await renderPlanMarkdown(999)).toBe("Plan not found.");
  });

  it("renders plan title and sections", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed({
      id: 1,
      title: "My Plan",
      summary: "A summary",
      context: "Some context",
      clarifications: "Q&A",
      completion_conditions: "All tests pass",
    }));
    mockQueryAllValidated.mockReturnValue(Effect.succeed([]));

    const result = await renderPlanMarkdown(1);
    expect(result).toContain("# Plan: My Plan");
    expect(result).toContain("## Summary\n\nA summary");
    expect(result).toContain("## Context\n\nSome context");
    expect(result).toContain("## Clarifications\n\nQ&A");
    expect(result).toContain("## Completion Conditions\n\nAll tests pass");
  });

  it("includes phases in the output", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed({
      id: 1,
      title: "Plan",
      summary: null,
      context: null,
      clarifications: null,
      completion_conditions: null,
    }));
    mockQueryAllValidated.mockReturnValue(Effect.succeed([
      {
        id: 10,
        step_number: 1,
        title: "Phase One",
        status: "pending",
        phase_type: "value",
        complexity: 3,
        commit_message: "feat: do things",
        prompt: "Do this thing",
        implementation_notes: null,
        deviations: null,
        order_index: 0,
        plan_id: 1,
      },
    ]));

    const result = await renderPlanMarkdown(1);
    expect(result).toContain("## Phases");
    expect(result).toContain("### Phase 1: Phase One");
    expect(result).toContain("**Status**: pending");
    expect(result).toContain("**Commit message**: feat: do things");
  });

  it("skips optional sections when null", async () => {
    mockQueryOneValidated.mockReturnValue(Effect.succeed({
      id: 1,
      title: "Lean Plan",
      summary: null,
      context: null,
      clarifications: null,
      completion_conditions: null,
    }));
    mockQueryAllValidated.mockReturnValue(Effect.succeed([]));

    const result = await renderPlanMarkdown(1);
    expect(result).not.toContain("## Summary");
    expect(result).not.toContain("## Context");
  });
});
