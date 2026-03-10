import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  transitionFeature,
  transitionPhase,
  transitionPhaseIf,
  transitionAgentSession,
} from "./state-transitions";

vi.mock("./effect-helpers", () => ({
  notifyDbUpdated: vi.fn(),
}));

import { notifyDbUpdated } from "./effect-helpers";
import { createMockDb } from "../test-utils";

const mockNotify = vi.mocked(notifyDbUpdated);

describe("transitionFeature", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
  });

  it("updates feature status and notifies renderer", () => {
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "draft" }) };
      return { run: vi.fn() };
    });

    transitionFeature(db as any, 1, "planned");

    expect(mockNotify).toHaveBeenCalledWith("feature", 1);
  });

  it("warns but still updates for invalid transition", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "draft" }) };
      return { run: vi.fn() };
    });

    transitionFeature(db as any, 1, "done");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid feature transition"));
    expect(mockNotify).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and returns early if feature not found", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.prepare.mockImplementation(() => ({ get: () => undefined }));

    transitionFeature(db as any, 99, "planned");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockNotify).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("transitionPhase", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates phase status and notifies renderer", () => {
    const runFn = vi.fn();
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "pending" }) };
      return { run: runFn };
    });

    transitionPhase(db as any, 10, "running", 5);

    expect(runFn).toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith("phase", 5);
  });

  it("includes extra columns in the update", () => {
    const runFn = vi.fn();
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "running" }) };
      return { run: runFn };
    });

    transitionPhase(db as any, 10, "completed", 5, { implementation_notes: "done" });

    const prepareCalls = db.prepare.mock.calls.map((c: string[]) => c[0]);
    const updateCall = prepareCalls.find((s: string) => s.includes("implementation_notes"));
    expect(updateCall).toBeTruthy();
  });

  it("warns for invalid transition but still updates", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "completed" }) };
      return { run: vi.fn() };
    });

    transitionPhase(db as any, 10, "running", 5);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid phase transition"));
    expect(mockNotify).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("warns and returns early if phase not found", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.prepare.mockImplementation(() => ({ get: () => undefined }));

    transitionPhase(db as any, 99, "running", 5);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockNotify).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("transitionPhaseIf", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies when the conditional update changes a row", () => {
    db.prepare.mockImplementation(() => ({ run: vi.fn().mockReturnValue({ changes: 1 }) }));

    transitionPhaseIf(db as any, 10, "running", "pending", 5);

    expect(mockNotify).toHaveBeenCalledWith("phase", 5);
  });

  it("does NOT notify when the condition doesn't match (no changes)", () => {
    db.prepare.mockImplementation(() => ({ run: vi.fn().mockReturnValue({ changes: 0 }) }));

    transitionPhaseIf(db as any, 10, "running", "pending", 5);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("transitionAgentSession", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates session status and notifies renderer", () => {
    const runFn = vi.fn();
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "running", feature_id: 5 }) };
      return { run: runFn };
    });

    transitionAgentSession(db as any, 20, "completed");

    expect(runFn).toHaveBeenCalled();
    expect(mockNotify).toHaveBeenCalledWith("agent_session", 5);
  });

  it("uses provided featureId over row feature_id", () => {
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "running", feature_id: 5 }) };
      return { run: vi.fn() };
    });

    transitionAgentSession(db as any, 20, "completed", 99);

    expect(mockNotify).toHaveBeenCalledWith("agent_session", 99);
  });

  it("skips notification if no featureId available", () => {
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "running", feature_id: null }) };
      return { run: vi.fn() };
    });

    transitionAgentSession(db as any, 20, "completed");

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("includes extra columns in the update", () => {
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "waiting", feature_id: 5 }) };
      return { run: vi.fn() };
    });

    transitionAgentSession(db as any, 20, "running", 5, { ended_at: "now" });

    const prepareCalls = db.prepare.mock.calls.map((c: string[]) => c[0]);
    const updateCall = prepareCalls.find((s: string) => s.includes("ended_at"));
    expect(updateCall).toBeTruthy();
  });

  it("warns for invalid transition but still updates", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.prepare.mockImplementation((sql: string) => {
      if (sql.includes("SELECT")) return { get: () => ({ status: "completed", feature_id: 5 }) };
      return { run: vi.fn() };
    });

    transitionAgentSession(db as any, 20, "waiting");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid session transition"));
    warnSpy.mockRestore();
  });

  it("warns and returns early if session not found", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    db.prepare.mockImplementation(() => ({ get: () => undefined }));

    transitionAgentSession(db as any, 99, "completed");

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
    expect(mockNotify).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
