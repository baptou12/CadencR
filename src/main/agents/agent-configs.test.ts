import { describe, it, expect, vi } from "vitest";

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => undefined),
      all: vi.fn(() => []),
      run: vi.fn(() => ({ lastInsertRowid: 1 })),
    })),
  })),
}));
vi.mock("./session-persistence", () => ({ notifyDbUpdated: vi.fn() }));
vi.mock("./plan-approval", () => ({ waitForPlanApproval: vi.fn() }));
vi.mock("./mcp-tools", () => ({
  createPlanMcpServer: vi.fn().mockReturnValue({}),
  createQaMcpServer: vi.fn().mockReturnValue({}),
  createReviewMcpServer: vi.fn().mockReturnValue({}),
  createCommonMcpServer: vi.fn().mockReturnValue({}),
  createWorkflowSessionMcpServer: vi.fn().mockReturnValue({}),
  createRetroMcpServer: vi.fn().mockReturnValue({}),
}));

import {
  createPlanConfig,
  createRiskConfig,
  createReviewConfig,
  createSessionConfig,
  createQaConfig,
  createRetroConfig,
  buildQaSystemPrompt,
  buildExecuteSystemPrompt,
} from "./agent-configs";
import {
  createPlanMcpServer,
  createQaMcpServer,
  createReviewMcpServer,
  createCommonMcpServer,
  createWorkflowSessionMcpServer,
  createRetroMcpServer,
} from "./mcp-tools";

describe("createPlanConfig", () => {
  it("returns agentType plan with correct fields", () => {
    const config = createPlanConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      description: "Build a login system",
      planId: 10,
    });

    expect(config.agentType).toBe("plan");
    expect(config.featureId).toBe(1);
    expect(config.projectId).toBe(2);
    expect(config.cwd).toBe("/cwd");
    expect(config.systemPrompt).toContain("Plan agent");
    expect(config.mcpServerFactory).toBeDefined();
  });

  it("mcpServerFactory creates productdevr-plan MCP server", () => {
    const config = createPlanConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      description: "Feature",
      planId: 10,
    });

    config.mcpServerFactory!("sub1", 5);
    expect(createPlanMcpServer).toHaveBeenCalledWith(10, 1, 5, expect.any(Function), undefined);
  });

  it("system prompt includes planning-only restriction", () => {
    const config = createPlanConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      description: "Feature",
      planId: 10,
    });

    expect(config.systemPrompt).toContain("PLANNING-ONLY agent");
    expect(config.systemPrompt).toContain("MUST NOT execute the plan");
    expect(config.systemPrompt).toContain("MUST NOT");
  });

  it("includes planId in the prompt", () => {
    const config = createPlanConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      description: "Feature",
      planId: 99,
    });

    expect(config.prompt).toContain("99");
  });
});

describe("createRiskConfig", () => {
  it("returns agentType risk with correct MCP server", () => {
    const config = createRiskConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      prompt: "Analyze risk",
    });

    expect(config.agentType).toBe("risk");
    expect(config.systemPrompt).toContain("risk");
    // risk system prompt exists and has content
    expect(config.systemPrompt?.length).toBeGreaterThan(0);

    config.mcpServerFactory!("sub1", 5);
    expect(createCommonMcpServer).toHaveBeenCalledWith(5, 1);
  });

  it("stores risk report in completion action", () => {
    const config = createRiskConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      prompt: "Risk analysis",
    });

    expect(config.completionActions?.[0].event).toBe("store_risk_report");
  });
});

describe("createReviewConfig", () => {
  it("returns agentType review with correct MCP server", () => {
    const config = createReviewConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      planId: 30,
    });

    expect(config.agentType).toBe("review");
    expect(config.systemPrompt).toContain("review");
    // review system prompt exists and has content
    expect(config.systemPrompt?.length).toBeGreaterThan(0);

    config.mcpServerFactory!("sub1", 5);
    expect(createReviewMcpServer).toHaveBeenCalledWith(30, 1, 5, undefined);
  });

  it("stores review report in completion action", () => {
    const config = createReviewConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      planId: 30,
    });

    expect(config.completionActions?.[0].event).toBe("store_review_report");
  });
});

describe("createSessionConfig", () => {
  it("returns agentType session", () => {
    const config = createSessionConfig({
      projectId: 2,
      cwd: "/cwd",
      prompt: "Help me code",
    });

    expect(config.agentType).toBe("session");
    expect(config.systemPrompt).toBeUndefined();
  });

  it("uses common MCP server when no planId", () => {
    const config = createSessionConfig({
      projectId: 2,
      cwd: "/cwd",
      prompt: "Help",
    });

    config.mcpServerFactory!("sub1", 5);
    expect(createCommonMcpServer).toHaveBeenCalled();
    expect(createWorkflowSessionMcpServer).not.toHaveBeenCalled();
  });

  it("uses workflow session MCP server when planId provided", () => {
    const config = createSessionConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      prompt: "Help",
      planId: 10,
    });

    config.mcpServerFactory!("sub1", 5);
    expect(createWorkflowSessionMcpServer).toHaveBeenCalled();
  });

  it("passes permissionMode and resumeSessionId", () => {
    const config = createSessionConfig({
      projectId: 2,
      cwd: "/cwd",
      prompt: "Help",
      permissionMode: "plan",
      resumeSessionId: "abc123",
    });

    expect(config.permissionMode).toBe("plan");
    expect(config.resumeSessionId).toBe("abc123");
  });
});

describe("createQaConfig", () => {
  it("returns agentType qa", () => {
    const config = createQaConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      qaPrompt: "Run tests",
      completedPhasesSummary: "Phase 1 done",
      planId: 40,
      phaseId: 99,
      qaPhaseStepNumber: 3,
    });

    expect(config.agentType).toBe("qa");
  });

  it("includes completed phases summary in prompt", () => {
    const config = createQaConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      qaPrompt: "Run tests",
      completedPhasesSummary: "Phase 1: Added login",
      planId: 40,
      phaseId: 99,
      qaPhaseStepNumber: 3,
    });

    expect(config.prompt).toContain("Phase 1: Added login");
  });

  it("includes fix phase step number in prompt", () => {
    const config = createQaConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      qaPrompt: "Run tests",
      completedPhasesSummary: "Done",
      planId: 40,
      phaseId: 99,
      qaPhaseStepNumber: 5,
    });

    expect(config.prompt).toContain("6"); // qaPhaseStepNumber + 1
  });

  it("stores qa report in completion action", () => {
    const config = createQaConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      qaPrompt: "Run tests",
      completedPhasesSummary: "Done",
      planId: 40,
      phaseId: 99,
      qaPhaseStepNumber: 3,
    });

    expect(config.completionActions?.[0].event).toBe("store_qa_report");
  });

  it("uses qa MCP server", () => {
    const config = createQaConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
      qaPrompt: "Run tests",
      completedPhasesSummary: "Done",
      planId: 40,
      phaseId: 99,
      qaPhaseStepNumber: 3,
    });

    config.mcpServerFactory!("sub1", 5);
    expect(createQaMcpServer).toHaveBeenCalledWith(40, 1, 5, undefined);
  });
});

describe("buildQaSystemPrompt", () => {
  it("returns a string for each autonomy level", () => {
    expect(typeof buildQaSystemPrompt(1)).toBe("string");
    expect(typeof buildQaSystemPrompt(2)).toBe("string");
    expect(typeof buildQaSystemPrompt(3)).toBe("string");
  });

  it("includes QA content", () => {
    const prompt = buildQaSystemPrompt(1);
    expect(prompt.length).toBeGreaterThan(100);
  });

  it("level 1 requires AskUserQuestion approval loop", () => {
    const prompt = buildQaSystemPrompt(1);
    expect(prompt).toContain("AskUserQuestion");
    expect(prompt).toContain("Approve QA report");
    expect(prompt).toContain("QA Approval Loop (MANDATORY)");
  });

  it("level 2 proceeds automatically without approval loop", () => {
    const prompt = buildQaSystemPrompt(2);
    expect(prompt).toContain("NEVER use AskUserQuestion");
    expect(prompt).not.toContain("QA Approval Loop (MANDATORY)");
  });

  it("level 3 full autonomy instructs agent to never ask user", () => {
    const prompt = buildQaSystemPrompt(3);
    expect(prompt).toContain("FULL AUTONOMY");
    expect(prompt).toContain("NEVER use AskUserQuestion");
    expect(prompt).toContain("NEVER ask for confirmation before creating fix phases");
    expect(prompt).toContain("NEVER ask for confirmation before running tests or validating the repo");
    expect(prompt).not.toContain("QA Approval Loop (MANDATORY)");
  });
});

describe("createRetroConfig", () => {
  it("returns agentType retro with correct fields", () => {
    const config = createRetroConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
    });

    expect(config.agentType).toBe("retro");
    expect(config.featureId).toBe(1);
    expect(config.projectId).toBe(2);
    expect(config.cwd).toBe("/cwd");
  });

  it("has a systemPrompt", () => {
    const config = createRetroConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
    });

    expect(config.systemPrompt).toBeDefined();
    expect(config.systemPrompt!.length).toBeGreaterThan(0);
  });

  it("has a store_retro_report completion action", () => {
    const config = createRetroConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
    });

    expect(config.completionActions).toBeDefined();
    expect(config.completionActions!.length).toBeGreaterThan(0);
    expect(config.completionActions![0].event).toBe("store_retro_report");
  });

  it("has mcpServerFactory defined", () => {
    const config = createRetroConfig({
      featureId: 1,
      projectId: 2,
      cwd: "/cwd",
    });

    expect(config.mcpServerFactory).toBeDefined();
    config.mcpServerFactory!("sub1", 5);
    expect(createRetroMcpServer).toHaveBeenCalledWith(1, 5);
  });
});

describe("buildExecuteSystemPrompt", () => {
  it("returns a string for each autonomy level", () => {
    expect(typeof buildExecuteSystemPrompt(1)).toBe("string");
    expect(typeof buildExecuteSystemPrompt(2)).toBe("string");
    expect(typeof buildExecuteSystemPrompt(3)).toBe("string");
  });

  it("includes execute content", () => {
    const prompt = buildExecuteSystemPrompt(1);
    expect(prompt.length).toBeGreaterThan(100);
  });
});
