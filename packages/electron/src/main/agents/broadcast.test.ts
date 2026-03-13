import { describe, it, expect } from "vitest";
import {
  AGENT_EVENT_CHANNEL,
  ASK_USER_QUESTION_CHANNEL,
  ASK_USER_ANSWER_CHANNEL,
  TOOL_PERMISSION_CHANNEL,
  DB_UPDATED_CHANNEL,
  BACKGROUND_TASK_CHANNEL,
} from "./broadcast";

// Note: broadcast() itself calls require("electron") internally.
// The electron module is external in the build config. For tests, we verify
// channel name constants and function existence without calling broadcast()
// directly (which would require a working BrowserWindow mock at require() time).

describe("broadcast channel constants", () => {
  it("exports correct agent event channel", () => {
    expect(AGENT_EVENT_CHANNEL).toBe("agent:event");
  });

  it("exports correct ask user question channel", () => {
    expect(ASK_USER_QUESTION_CHANNEL).toBe("agent:ask-user-question");
  });

  it("exports correct ask user answer channel", () => {
    expect(ASK_USER_ANSWER_CHANNEL).toBe("agent:ask-user-answer");
  });

  it("exports correct tool permission channel", () => {
    expect(TOOL_PERMISSION_CHANNEL).toBe("agent:tool-permission");
  });

  it("exports correct db updated channel", () => {
    expect(DB_UPDATED_CHANNEL).toBe("db:updated");
  });

  it("exports correct background task channel", () => {
    expect(BACKGROUND_TASK_CHANNEL).toBe("agent:background-tasks");
  });

  it("exports a broadcast function", async () => {
    const mod = await import("./broadcast");
    expect(typeof mod.broadcast).toBe("function");
  });
});
