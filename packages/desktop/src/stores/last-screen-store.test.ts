import { describe, expect, it } from "vitest";
import { isMeaningfulScreenPath, useLastScreenStore } from "./last-screen-store";

describe("isMeaningfulScreenPath", () => {
  it.each([
    ["/agents", true],
    ["/projects/1/features/2", true],
    ["/projects/12/features/345/diff", true],
    ["/ws-session/abc123", true],
    ["/ws-session/abc123/log", true],
    ["/", false],
    ["/settings", false],
    ["/settings/?section=appearance", false],
    ["/agents/foo", false],
    ["/projects/1", false],
    ["/projects/1/features", false],
    ["/onboarding", false],
  ])("%s → %s", (path, expected) => {
    expect(isMeaningfulScreenPath(path)).toBe(expected);
  });
});

describe("useLastScreenStore", () => {
  it("stores and reads the last screen", () => {
    useLastScreenStore.setState({ lastScreen: null });

    useLastScreenStore.getState().setLastScreen({ pathname: "/agents", search: {} });

    expect(useLastScreenStore.getState().lastScreen).toEqual({
      pathname: "/agents",
      search: {},
    });
  });

  it("preserves search params alongside the pathname", () => {
    useLastScreenStore.setState({ lastScreen: null });

    useLastScreenStore.getState().setLastScreen({
      pathname: "/ws-session/ws-feature-7",
      search: { cwd: "/Users/foo/proj", featureId: 7, projectId: 1 },
    });

    expect(useLastScreenStore.getState().lastScreen?.search).toEqual({
      cwd: "/Users/foo/proj",
      featureId: 7,
      projectId: 1,
    });
  });
});
