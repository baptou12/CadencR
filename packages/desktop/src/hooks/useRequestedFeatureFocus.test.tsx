import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ROOT_LEAF_ID, type FeatureLayoutState } from "@/stores/feature-layout-schema";
import { getFocusedTab, useFeatureLayoutStore } from "@/stores/feature-layout-store";

import { useRequestedFeatureFocus } from "./useRequestedFeatureFocus";

const FEATURE_ID = 7;

function resetStore(): void {
  useFeatureLayoutStore.setState({ features: {} });
}

function splitLayout(): FeatureLayoutState {
  return {
    version: 1,
    splitRoot: {
      type: "split",
      orientation: "horizontal",
      children: [
        {
          type: "leaf",
          id: ROOT_LEAF_ID,
          tabIds: ["agent", "git", "editor"],
          activeTabId: "agent",
        },
        {
          type: "leaf",
          id: "terminal-pane",
          tabIds: ["terminal"],
          activeTabId: "terminal",
        },
      ],
    },
    focusedPaneId: ROOT_LEAF_ID,
    appliedLayoutId: null,
  };
}

describe("useRequestedFeatureFocus", () => {
  beforeEach(resetStore);
  afterEach(() => vi.useRealTimers());

  it("does not initialize a fallback layout while waiting for hydration", () => {
    const { result } = renderHook(() => useRequestedFeatureFocus(FEATURE_ID, "terminal"));

    expect(result.current).toBe(true);
    expect(useFeatureLayoutStore.getState().features[FEATURE_ID]).toBeUndefined();
  });

  it("focuses the pane containing the requested tab after hydration", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, splitLayout());

    const { result } = renderHook(() => useRequestedFeatureFocus(FEATURE_ID, "terminal"));

    const state = useFeatureLayoutStore.getState().features[FEATURE_ID];
    expect(result.current).toBe(false);
    expect(state?.focusedPaneId).toBe("terminal-pane");
    expect(state ? getFocusedTab(state) : null).toBe("terminal");
  });

  it("falls back without changing layout when the requested tab is absent", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, splitLayout());

    const { result } = renderHook(() => useRequestedFeatureFocus(FEATURE_ID, null));

    const state = useFeatureLayoutStore.getState().features[FEATURE_ID];
    expect(result.current).toBe(false);
    expect(state?.focusedPaneId).toBe(ROOT_LEAF_ID);
    expect(state ? getFocusedTab(state) : null).toBe("agent");
  });

  it("focuses the root pane when agent is already active but another pane owns focus", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, {
      ...splitLayout(),
      focusedPaneId: "terminal-pane",
    });

    renderHook(() => useRequestedFeatureFocus(FEATURE_ID, "agent"));

    const state = useFeatureLayoutStore.getState().features[FEATURE_ID];
    expect(state?.focusedPaneId).toBe(ROOT_LEAF_ID);
    expect(state ? getFocusedTab(state) : null).toBe("agent");
  });

  it("does not keep overriding user focus after the request has been applied", () => {
    useFeatureLayoutStore.getState().setState(FEATURE_ID, splitLayout());

    renderHook(() => useRequestedFeatureFocus(FEATURE_ID, "agent"));

    act(() => {
      useFeatureLayoutStore.getState().setPaneActiveTab(FEATURE_ID, ROOT_LEAF_ID, "git");
    });

    const state = useFeatureLayoutStore.getState().features[FEATURE_ID];
    expect(state?.focusedPaneId).toBe(ROOT_LEAF_ID);
    expect(state ? getFocusedTab(state) : null).toBe("git");
  });

  it("retries briefly after completion so mounted inputs cannot steal requested focus", () => {
    vi.useFakeTimers();
    useFeatureLayoutStore.getState().setState(FEATURE_ID, splitLayout());

    renderHook(() => useRequestedFeatureFocus(FEATURE_ID, "git"));

    act(() => {
      useFeatureLayoutStore.getState().setPaneActiveTab(FEATURE_ID, "terminal-pane", "terminal");
    });
    expect(getFocusedTab(useFeatureLayoutStore.getState().features[FEATURE_ID])).toBe("terminal");

    act(() => vi.advanceTimersByTime(50));

    const state = useFeatureLayoutStore.getState().features[FEATURE_ID];
    expect(state?.focusedPaneId).toBe(ROOT_LEAF_ID);
    expect(state ? getFocusedTab(state) : null).toBe("git");
  });
});
