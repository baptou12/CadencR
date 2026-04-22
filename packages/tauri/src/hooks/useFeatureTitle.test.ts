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

interface StoreOpts {
  workflowFeatureId?: number | null;
  workflowTitle?: string | null;
  workflowAutoNaming?: boolean;
  sessionTitle?: string | null;
  sessionAutoNaming?: boolean;
}

function setupStores(opts: StoreOpts) {
  mockWorkflowStore.mockImplementation(
    (
      selector: (s: {
        featureId: number | null;
        featureTitle: string | null;
        isAutoNaming: boolean;
      }) => unknown,
    ) =>
      selector({
        featureId: opts.workflowFeatureId ?? null,
        featureTitle: opts.workflowTitle ?? null,
        isAutoNaming: opts.workflowAutoNaming ?? false,
      }),
  );
  mockWsSessionStore.mockImplementation(
    (
      selector: (s: {
        sessions: Record<string, { featureTitle?: string | null; isAutoNaming?: boolean }>;
      }) => unknown,
    ) =>
      selector({
        sessions:
          opts.sessionTitle || opts.sessionAutoNaming
            ? {
                "ws-feature-42": {
                  featureTitle: opts.sessionTitle ?? null,
                  isAutoNaming: opts.sessionAutoNaming ?? false,
                },
              }
            : {},
      }),
  );
}

describe("useFeatureTitle", () => {
  beforeEach(() => {
    mockWorkflowStore.mockReset();
    mockWsSessionStore.mockReset();
  });

  it("returns null title and not auto-naming when stores are empty", () => {
    setupStores({});
    expect(useFeatureTitle(42)).toEqual({ title: null, isAutoNaming: false });
  });

  it("returns session store title when workflow has no match", () => {
    setupStores({ sessionTitle: "Session Title" });
    expect(useFeatureTitle(42).title).toBe("Session Title");
  });

  it("returns workflow title when featureId matches", () => {
    setupStores({
      workflowFeatureId: 42,
      workflowTitle: "Workflow Title",
      sessionTitle: "Session Title",
    });
    expect(useFeatureTitle(42).title).toBe("Workflow Title");
  });

  it("ignores workflow title when featureId does not match", () => {
    setupStores({
      workflowFeatureId: 99,
      workflowTitle: "Wrong Feature",
      sessionTitle: "Session Title",
    });
    expect(useFeatureTitle(42).title).toBe("Session Title");
  });

  it("returns null title when workflow featureId matches but title is null", () => {
    setupStores({
      workflowFeatureId: 42,
      workflowTitle: null,
      sessionTitle: null,
    });
    expect(useFeatureTitle(42).title).toBeNull();
  });

  it("reflects workflow auto-naming flag when featureId matches", () => {
    setupStores({ workflowFeatureId: 42, workflowAutoNaming: true });
    expect(useFeatureTitle(42).isAutoNaming).toBe(true);
  });

  it("reflects session-store auto-naming flag", () => {
    setupStores({ sessionAutoNaming: true });
    expect(useFeatureTitle(42).isAutoNaming).toBe(true);
  });
});
