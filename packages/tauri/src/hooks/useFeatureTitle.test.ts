import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock both stores before importing the hook
const mockWorkflowStore = vi.fn();
const mockWsSessionStore = vi.fn();

vi.mock("@/hooks/useWorkflowWebSocket", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) => mockWorkflowStore(selector),
}));

vi.mock("@/stores/ws-session-store", () => ({
  useWsSessionStore: (selector: (s: unknown) => unknown) => mockWsSessionStore(selector),
}));

import { useFeatureTitle } from "./useFeatureTitle";

function setupStores(opts: {
  workflowFeatureId?: number | null;
  workflowTitle?: string | null;
  sessionTitle?: string | null;
}) {
  mockWorkflowStore.mockImplementation((selector: (s: { featureId: number | null; featureTitle: string | null }) => unknown) =>
    selector({
      featureId: opts.workflowFeatureId ?? null,
      featureTitle: opts.workflowTitle ?? null,
    }),
  );
  mockWsSessionStore.mockImplementation((selector: (s: { sessions: Record<string, { featureTitle?: string | null }> }) => unknown) =>
    selector({
      sessions: opts.sessionTitle
        ? { "ws-feature-42": { featureTitle: opts.sessionTitle } }
        : {},
    }),
  );
}

describe("useFeatureTitle", () => {
  beforeEach(() => {
    mockWorkflowStore.mockReset();
    mockWsSessionStore.mockReset();
  });

  it("returns null when no stores have a title", () => {
    setupStores({});
    expect(useFeatureTitle(42)).toBeNull();
  });

  it("returns session store title when workflow has no match", () => {
    setupStores({ sessionTitle: "Session Title" });
    expect(useFeatureTitle(42)).toBe("Session Title");
  });

  it("returns workflow title when featureId matches", () => {
    setupStores({
      workflowFeatureId: 42,
      workflowTitle: "Workflow Title",
      sessionTitle: "Session Title",
    });
    expect(useFeatureTitle(42)).toBe("Workflow Title");
  });

  it("ignores workflow title when featureId does not match", () => {
    setupStores({
      workflowFeatureId: 99,
      workflowTitle: "Wrong Feature",
      sessionTitle: "Session Title",
    });
    expect(useFeatureTitle(42)).toBe("Session Title");
  });

  it("returns null when workflow featureId matches but title is null", () => {
    setupStores({
      workflowFeatureId: 42,
      workflowTitle: null,
      sessionTitle: null,
    });
    expect(useFeatureTitle(42)).toBeNull();
  });
});
