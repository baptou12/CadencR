import { describe, expect, it } from "vitest";
import { liveStatusFromLifecycle } from "@/lib/agent-status";

describe("liveStatusFromLifecycle", () => {
  it("maps active to agent", () => {
    expect(liveStatusFromLifecycle({ phase: "active" })).toBe("agent");
  });

  it("maps user-actionable paused reasons to question", () => {
    expect(liveStatusFromLifecycle({ phase: "paused", reason: "permission" })).toBe("question");
    expect(liveStatusFromLifecycle({ phase: "paused", reason: "question" })).toBe("question");
    expect(liveStatusFromLifecycle({ phase: "paused", reason: "planApproval" })).toBe("question");
    expect(liveStatusFromLifecycle({ phase: "paused", reason: "user" })).toBe("question");
  });

  it("maps the OS-suspend paused reason to idle", () => {
    // OS sleep isn't user-attention-requested — the "Awaiting input"
    // badge would be misleading during system wake.
    expect(liveStatusFromLifecycle({ phase: "paused", reason: "suspended" })).toBe("idle");
  });

  it("maps idle / terminal / error to idle", () => {
    expect(liveStatusFromLifecycle({ phase: "idle" })).toBe("idle");
    expect(liveStatusFromLifecycle({ phase: "terminal", reason: "completed" })).toBe("idle");
    expect(liveStatusFromLifecycle({ phase: "error" })).toBe("idle");
  });
});
