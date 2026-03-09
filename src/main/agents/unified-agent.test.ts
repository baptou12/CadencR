/**
 * Tests for unified-agent.ts — DB session creation, config selection, completion handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

vi.mock("../db/database", () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }),
      get: vi.fn().mockReturnValue({ status: "running" }),
      all: vi.fn().mockReturnValue([]),
    })),
  })),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
    promises: {
      access: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
  },
}));

const mockManagedSubprocess = {
  id: "subprocess-1",
  agentType: "plan",
  status: "running",
  eventListeners: [] as any[],
  completionListeners: [] as any[],
  sdkSessionId: undefined as string | undefined,
};

vi.mock("./subprocess-manager", () => ({
  startSubprocess: vi.fn().mockImplementation(() => mockManagedSubprocess),
  generateSubprocessId: vi.fn().mockReturnValue("pre-gen-id"),
}));

vi.mock("./effect-helpers", () => ({
  registerSessionPersistence: vi.fn(),
}));

vi.mock("./state-transitions", () => ({
  transitionAgentSession: vi.fn(),
}));

vi.mock("./models", () => ({
  resolveModel: vi.fn().mockReturnValue("claude-opus-4-5"),
}));

vi.mock("./utils", () => ({
  extractTextFromEvent: vi.fn().mockReturnValue(""),
}));

import { startUnifiedAgent } from "./unified-agent";
import { getDatabase } from "../db/database";
import * as subprocessManager from "./subprocess-manager";

describe("startUnifiedAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset subprocess listeners
    mockManagedSubprocess.eventListeners = [];
    mockManagedSubprocess.completionListeners = [];
    mockManagedSubprocess.id = "subprocess-1";

    (subprocessManager.startSubprocess as any).mockImplementation(() => mockManagedSubprocess);

    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((_sql: string) => ({
        run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }),
        get: vi.fn().mockReturnValue({ status: "running" }),
        all: vi.fn().mockReturnValue([]),
      })),
    });

    (fs.existsSync as any).mockReturnValue(true);
    (fs.statSync as any).mockReturnValue({ isDirectory: () => true });
    (fs.promises.access as any).mockResolvedValue(undefined);
    (fs.promises.stat as any).mockResolvedValue({ isDirectory: () => true });
  });

  it("validates CWD exists before starting", async () => {
    (fs.promises.access as any).mockRejectedValueOnce(new Error("ENOENT"));

    await expect(
      startUnifiedAgent({
        cwd: "/nonexistent",
        agentType: "plan",
        featureId: 1,
        projectId: 1,
        prompt: "Test",
      } as any),
    ).rejects.toThrow("does not exist");
  });

  it("validates CWD is a directory", async () => {
    (fs.promises.stat as any).mockResolvedValueOnce({ isDirectory: () => false });

    await expect(
      startUnifiedAgent({
        cwd: "/some/file",
        agentType: "plan",
        featureId: 1,
        projectId: 1,
        prompt: "Test",
      } as any),
    ).rejects.toThrow("not a directory");
  });

  it("creates a new DB session on start", async () => {
    const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: 55 });
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("INSERT INTO agent_sessions")) return { run: insertRun };
        return {
          run: vi.fn(),
          get: vi.fn().mockReturnValue({ status: "running" }),
          all: vi.fn().mockReturnValue([]),
        };
      }),
    });

    const result = await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "plan",
      featureId: 1,
      projectId: 1,
      prompt: "Plan this",
    } as any);

    expect(insertRun).toHaveBeenCalled();
    expect(result.sessionDbId).toBe(55);
  });

  it("returns subprocess ID from managed subprocess", async () => {
    const result = await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "session",
      featureId: 1,
      projectId: 1,
      prompt: "Hello",
    } as any);

    expect(result.subprocessId).toBe("subprocess-1");
    expect(result.agentType).toBe("session");
  });

  it("reuses existing session when existingSessionDbId is provided", async () => {
    const updateRun = vi.fn();
    const insertRun = vi.fn().mockReturnValue({ lastInsertRowid: 42 });
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("UPDATE agent_sessions SET status = 'running'")) return { run: updateRun };
        if (sql.includes("INSERT INTO agent_sessions")) return { run: insertRun };
        return {
          run: vi.fn(),
          get: vi.fn().mockReturnValue({ status: "running" }),
          all: vi.fn().mockReturnValue([]),
        };
      }),
    });

    await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "session",
      featureId: 1,
      projectId: 1,
      prompt: "Resume",
      existingSessionDbId: 99,
    } as any);

    expect(updateRun).toHaveBeenCalled();
    expect(insertRun).not.toHaveBeenCalled();
  });

  it("persists initial user message to DB", async () => {
    const msgRun = vi.fn();
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("INSERT INTO agent_messages")) return { run: msgRun };
        return {
          run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }),
          get: vi.fn().mockReturnValue({ status: "running" }),
          all: vi.fn().mockReturnValue([]),
        };
      }),
    });

    await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "plan",
      featureId: 1,
      projectId: 1,
      prompt: "My initial prompt",
    } as any);

    expect(msgRun).toHaveBeenCalledWith(
      expect.any(Number),
      "user",
      "My initial prompt",
      "user_message",
      null,
    );
  });

  it("calls completion actions on subprocess completion", async () => {
    const completionHandler = vi.fn();

    await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "plan",
      featureId: 1,
      projectId: 1,
      prompt: "Plan this",
      completionActions: [
        { event: "done", handler: completionHandler },
      ],
    } as any);

    const completionListener = mockManagedSubprocess.completionListeners[0];
    await completionListener(0);

    expect(completionHandler).toHaveBeenCalledWith(
      "",
      expect.objectContaining({ exitCode: 0 }),
    );
  });

  it("stores subprocess_id in DB after spawning", async () => {
    const subprocRun = vi.fn();
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("subprocess_id")) return { run: subprocRun };
        return {
          run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }),
          get: vi.fn().mockReturnValue({ status: "running" }),
          all: vi.fn().mockReturnValue([]),
        };
      }),
    });

    await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "plan",
      featureId: 1,
      projectId: 1,
      prompt: "Test",
    } as any);

    expect(subprocRun).toHaveBeenCalledWith("subprocess-1", expect.any(Number));
  });

  it("uses mcpServerFactory when provided", async () => {
    const factory = vi.fn().mockReturnValue({ "my-server": { command: "run" } });

    await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "execute",
      featureId: 1,
      projectId: 1,
      prompt: "Test",
      mcpServerFactory: factory,
    } as any);

    expect(factory).toHaveBeenCalledWith("pre-gen-id", expect.any(Number));
    expect(subprocessManager.startSubprocess).toHaveBeenCalledWith(
      expect.objectContaining({ mcpServers: { "my-server": { command: "run" } } }),
    );
  });

  it("does not overwrite paused status on completion", async () => {
    const sessionGet = vi.fn().mockReturnValue({ status: "paused" });
    (getDatabase as any).mockReturnValue({
      prepare: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("SELECT status FROM agent_sessions")) return { get: sessionGet };
        return {
          run: vi.fn().mockReturnValue({ lastInsertRowid: 42 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      }),
    });

    const { transitionAgentSession } = await import("./state-transitions");

    await startUnifiedAgent({
      cwd: "/some/dir",
      agentType: "plan",
      featureId: 1,
      projectId: 1,
      prompt: "Test",
    } as any);

    const completionListener = mockManagedSubprocess.completionListeners[0];
    await completionListener(0);

    // Should NOT transition since status is paused
    expect(transitionAgentSession).not.toHaveBeenCalled();
  });
});
