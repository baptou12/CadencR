import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";

vi.mock("../db/database");
vi.mock("../db/settings", () => ({
  resolveSetting: vi.fn(),
}));
vi.mock("../../shared/models", () => ({
  DEFAULT_MODEL: "claude-opus-4-5-20251001",
}));

import { resolveModel } from "./models";
import { resolveSetting } from "../db/settings";

const mockResolveSetting = vi.mocked(resolveSetting);

describe("resolveModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the resolved model for a given agent type", () => {
    mockResolveSetting.mockReturnValue(Effect.succeed("claude-haiku-4-5-20251001"));
    const result = resolveModel("plan", 1, 2);
    expect(result).toBe("claude-haiku-4-5-20251001");
    expect(mockResolveSetting).toHaveBeenCalledWith("model_plan", {
      featureId: 1,
      projectId: 2,
      defaultValue: "claude-opus-4-5-20251001",
    });
  });

  it("uses DEFAULT_MODEL as the default value", () => {
    mockResolveSetting.mockReturnValue(Effect.succeed("claude-opus-4-5-20251001"));
    const result = resolveModel("execute");
    expect(result).toBe("claude-opus-4-5-20251001");
    expect(mockResolveSetting).toHaveBeenCalledWith("model_execute", {
      featureId: undefined,
      projectId: undefined,
      defaultValue: "claude-opus-4-5-20251001",
    });
  });

  it("works without featureId and projectId", () => {
    mockResolveSetting.mockReturnValue(Effect.succeed("claude-opus-4-5-20251001"));
    resolveModel("review");
    expect(mockResolveSetting).toHaveBeenCalledWith("model_review", {
      featureId: undefined,
      projectId: undefined,
      defaultValue: "claude-opus-4-5-20251001",
    });
  });

  it("passes the correct key for each agent type", () => {
    mockResolveSetting.mockReturnValue(Effect.succeed("claude-opus-4-5-20251001"));
    const agentTypes = ["plan", "prd", "execute", "risk", "review", "session", "qa"] as const;
    for (const type of agentTypes) {
      resolveModel(type);
      expect(mockResolveSetting).toHaveBeenCalledWith(`model_${type}`, expect.any(Object));
    }
  });

  it('resolves literal "default" to DEFAULT_MODEL', () => {
    mockResolveSetting.mockReturnValue(Effect.succeed("default"));
    const result = resolveModel("session");
    expect(result).toBe("claude-opus-4-5-20251001");
  });

  it('does not replace model names containing "default" as a substring', () => {
    mockResolveSetting.mockReturnValue(Effect.succeed("my-default-model"));
    const result = resolveModel("session");
    expect(result).toBe("my-default-model");
  });
});
