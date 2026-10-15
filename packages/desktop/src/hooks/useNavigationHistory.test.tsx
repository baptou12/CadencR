import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";

import {
  activateFeatureTab,
  getFocusedTab,
  useFeatureLayoutStore,
} from "@/stores/feature-layout-store";
import { useNavigationHistory } from "./useNavigationHistory";

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  session: undefined as
    | {
        params: { sessionId: string };
        search: { cwd: string; featureId: number; projectId: number };
      }
    | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => router.navigate,
  useMatch: () => router.session,
  useRouterState: ({ select }: { select: (state: { location: { href: string } }) => unknown }) =>
    select({ location: { href: router.session ? "/ws-session" : "/settings" } }),
}));

const search = (featureId: number) => ({ cwd: "/repo", featureId, projectId: 1 });

function settle(): void {
  act(() => vi.advanceTimersByTime(300));
}

function open(featureId: number, rerender: () => void): void {
  useFeatureLayoutStore.getState().ensureInitialized(featureId);
  router.session = { params: { sessionId: `ws-${featureId}` }, search: search(featureId) };
  rerender();
  settle();
}

function focusTab(featureId: number, tab: "agent" | "browser"): void {
  act(() => void activateFeatureTab(featureId, tab));
  settle();
}

// `test-setup.ts` pins macOS, so `mod` resolves to Meta.
function pressBack(target: Element | Window = window): void {
  fireEvent.keyDown(target, { key: "[", code: "BracketLeft", metaKey: true });
}

describe("useNavigationHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useFeatureLayoutStore.setState({ features: {} });
    router.navigate.mockReset();
    router.session = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("⌘[ reopens the previous conversation on the tab it had", () => {
    const { rerender } = renderHook(() => useNavigationHistory());
    open(1, rerender);
    focusTab(1, "browser");
    open(2, rerender);

    pressBack();

    expect(router.navigate).toHaveBeenCalledWith({
      to: "/ws-session/$sessionId",
      params: { sessionId: "ws-1" },
      search: { ...search(1), focusTab: "browser" },
    });
  });

  it("⌘[ after switching to the browser tab returns to the previous tab", () => {
    const { rerender } = renderHook(() => useNavigationHistory());
    open(1, rerender);
    focusTab(1, "browser");

    act(() => pressBack());

    expect(getFocusedTab(useFeatureLayoutStore.getState().features[1])).toBe("agent");
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("⌘[ returns to a page that is not a conversation", () => {
    const { rerender } = renderHook(() => useNavigationHistory());
    rerender();
    settle();
    open(1, rerender);

    pressBack();

    expect(router.navigate).toHaveBeenCalledWith({ href: "/settings" });
  });

  it("leaves ⌘[ to CodeMirror's indent-less inside an editor buffer", () => {
    const { rerender } = renderHook(() => useNavigationHistory());
    open(1, rerender);
    open(2, rerender);
    const editor = document.createElement("div");
    editor.className = "cm-editor";
    document.body.append(editor);

    pressBack(editor);

    expect(router.navigate).not.toHaveBeenCalled();
    editor.remove();
  });
});
