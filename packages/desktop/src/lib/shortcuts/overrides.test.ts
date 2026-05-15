import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useResolvedShortcut, useShortcutOverridesStore } from "./overrides";

afterEach(() => {
  useShortcutOverridesStore.getState().resetAll();
});

describe("overrides store", () => {
  it("re-binds when setOverride is called and restores on clearOverride", () => {
    const { result } = renderHook(() => useResolvedShortcut("toggle-sidebar"));
    expect(result.current.keys).toEqual(["mod", "b"]);

    act(() => {
      useShortcutOverridesStore.getState().setOverride("toggle-sidebar", {
        keys: ["mod", "shift", "b"],
      });
    });
    expect(result.current.keys).toEqual(["mod", "shift", "b"]);

    act(() => {
      useShortcutOverridesStore.getState().clearOverride("toggle-sidebar");
    });
    expect(result.current.keys).toEqual(["mod", "b"]);
  });

  it("resetAll empties every override at once", () => {
    const store = useShortcutOverridesStore.getState();
    store.setOverride("toggle-sidebar", { keys: ["mod", "shift", "b"] });
    store.setOverride("command-palette", { keys: ["mod", "shift", "k"] });
    store.resetAll();
    expect(store.overrides).toEqual({});
  });
});

describe("useResolvedShortcut", () => {
  it("does NOT re-render when an unrelated override changes (narrow selector)", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useResolvedShortcut("toggle-sidebar");
    });
    const baseline = renders;

    act(() => {
      useShortcutOverridesStore.getState().setOverride("command-palette", {
        keys: ["mod", "shift", "k"],
      });
    });
    expect(renders).toBe(baseline);
  });
});
