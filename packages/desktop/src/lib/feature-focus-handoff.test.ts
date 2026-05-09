import { beforeEach, describe, expect, it } from "vitest";

import { ROOT_LEAF_ID } from "@/stores/feature-layout-schema";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";

import { getFocusedTabForFeature } from "./feature-focus-handoff";

describe("getFocusedTabForFeature", () => {
  beforeEach(() => {
    useFeatureLayoutStore.setState({ features: {} });
  });

  it("returns undefined when the feature layout has not hydrated", () => {
    expect(getFocusedTabForFeature(7)).toBeUndefined();
  });

  it("returns the focused tab from hydrated layout state", () => {
    useFeatureLayoutStore.getState().setState(7, {
      version: 1,
      splitRoot: {
        type: "leaf",
        id: ROOT_LEAF_ID,
        tabIds: ["agent", "terminal", "git", "editor"],
        activeTabId: "git",
      },
      focusedPaneId: ROOT_LEAF_ID,
      appliedLayoutId: null,
    });

    expect(getFocusedTabForFeature(7)).toBe("git");
  });
});
