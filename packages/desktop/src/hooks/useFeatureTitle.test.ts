import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWsSessionStore = vi.fn();

vi.mock("@/stores/ws-session-store", () => ({
  useWsSessionStore: (selector: (s: unknown) => unknown) => mockWsSessionStore(selector),
}));

import { useFeatureTitle } from "./useFeatureTitle";

interface StoreOpts {
  sessionTitle?: string | null;
  sessionAutoNaming?: boolean;
}

function setupStores(opts: StoreOpts) {
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
    mockWsSessionStore.mockReset();
  });

  it("returns null title and not auto-naming when stores are empty", () => {
    setupStores({});
    expect(useFeatureTitle(42)).toEqual({ title: null, isAutoNaming: false });
  });

  it("returns session store title when set", () => {
    setupStores({ sessionTitle: "Session Title" });
    expect(useFeatureTitle(42).title).toBe("Session Title");
  });

  it("returns null title when session entry is empty", () => {
    setupStores({ sessionTitle: null });
    expect(useFeatureTitle(42).title).toBeNull();
  });

  it("reflects session-store auto-naming flag", () => {
    setupStores({ sessionAutoNaming: true });
    expect(useFeatureTitle(42).isAutoNaming).toBe(true);
  });
});
