import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { createMockDb } from "../test-utils";

// We need to mock the database module before importing settings
const mockDb = createMockDb();

vi.mock("./database", () => ({
  getDatabase: vi.fn(() => mockDb),
}));

describe("resolveSetting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset prepare to return a fresh statement mock each call
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }));
  });

  it("returns defaultValue when no value found anywhere", async () => {
    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("model_plan", { defaultValue: "claude-opus-4-5" }));
    expect(result).toBe("claude-opus-4-5");
  });

  it("returns null when no value and no default", async () => {
    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("model_plan", {}));
    expect(result).toBeNull();
  });

  it("returns global settings value when found", async () => {
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue({ value: "claude-sonnet-4-5" }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }));

    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("model_plan", { defaultValue: "default-model" }));
    expect(result).toBe("claude-sonnet-4-5");
  });

  it("returns feature-level value for SHARED_COLUMNS when featureId provided", async () => {
    let callCount = 0;
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return { v: "feature-model" };
        return undefined;
      }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }));

    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("model_plan", { featureId: 1, projectId: 2, defaultValue: "default" }));
    expect(result).toBe("feature-model");
  });

  it("falls back to project-level value when feature value is null", async () => {
    let callCount = 0;
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return { v: null }; // feature: no value
        if (callCount === 2) return { v: "project-model" }; // project: has value
        return undefined;
      }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }));

    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("model_plan", { featureId: 1, projectId: 2, defaultValue: "default" }));
    expect(result).toBe("project-model");
  });

  it("skips feature lookup for PROJECT_ONLY_COLUMNS", async () => {
    let callCount = 0;
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return { v: "prefix-" }; // project lookup
        return undefined;
      }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }));

    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("branch_prefix", { featureId: 1, projectId: 2 }));
    // Should only do one lookup (project-level) and return the value
    expect(result).toBe("prefix-");
  });

  it("does not query feature table when featureId not provided", async () => {
    mockDb.prepare.mockImplementation(() => ({
      get: vi.fn().mockReturnValue({ value: "global-model" }),
      all: vi.fn().mockReturnValue([]),
      run: vi.fn(),
    }));

    const { resolveSetting } = await import("./settings");
    const result = Effect.runSync(resolveSetting("model_plan", { defaultValue: "default" }));
    // Only global settings query should have been called
    expect(mockDb.prepare).toHaveBeenCalledTimes(1);
    expect(result).toBe("global-model");
  });
});
