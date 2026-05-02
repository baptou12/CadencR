import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactElement } from "react";
import { act, fireEvent, render } from "@/test-utils";
import { useScopedGlobalShortcut, useScopedHotkeys } from "./useScopedHotkeys";
import { FeatureLayoutProvider } from "@/components/feature-layout/FeatureLayoutContext";
import { useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { ROOT_LEAF_ID, type TabKind } from "@/stores/feature-layout-schema";

const FEATURE_ID = 42;

/**
 * Seed the feature-layout store with a flat layout where the focused pane has
 * `activeTab` as its activeTabId. Returns a cleanup that resets the store.
 */
function seedLayout(activeTab: TabKind): () => void {
  useFeatureLayoutStore.setState((s) => ({
    ...s,
    features: {
      ...s.features,
      [FEATURE_ID]: {
        version: 1,
        splitRoot: {
          type: "leaf",
          id: ROOT_LEAF_ID,
          tabIds: ["agent", "terminal", "git", "editor"],
          activeTabId: activeTab,
        },
        focusedPaneId: ROOT_LEAF_ID,
        appliedLayoutId: null,
      },
    },
  }));
  return () => {
    useFeatureLayoutStore.setState((s) => {
      const next = { ...s.features };
      delete next[FEATURE_ID];
      return { ...s, features: next };
    });
  };
}

function ScopedHarness({
  scope,
  onFire,
  combo = "meta+x",
  enabled,
}: {
  scope: TabKind;
  onFire: () => void;
  combo?: string;
  enabled?: boolean;
}): ReactElement {
  useScopedHotkeys(combo, onFire, scope, enabled === undefined ? undefined : { enabled });
  return <div data-testid="harness" tabIndex={0} />;
}

function GlobalShortcutHarness({
  scope,
  onFire,
  withTextarea = false,
}: {
  scope: TabKind;
  onFire: () => void;
  withTextarea?: boolean;
}): ReactElement {
  useScopedGlobalShortcut("ctrl+d", onFire, scope);
  return withTextarea ? <textarea data-testid="ta" /> : <div data-testid="harness" tabIndex={0} />;
}

function withProvider(child: ReactElement): ReactElement {
  return <FeatureLayoutProvider featureId={FEATURE_ID}>{child}</FeatureLayoutProvider>;
}

describe("useScopedHotkeys", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("fires the callback when the scope matches the focused tab", () => {
    cleanup = seedLayout("git");
    const onFire = vi.fn();
    render(withProvider(<ScopedHarness scope="git" onFire={onFire} />));

    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the focused tab differs from the scope", () => {
    cleanup = seedLayout("terminal");
    const onFire = vi.fn();
    render(withProvider(<ScopedHarness scope="git" onFire={onFire} />));

    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });

    expect(onFire).not.toHaveBeenCalled();
  });

  it("treats absence of FeatureLayoutContext as 'unscoped' (always fires)", () => {
    cleanup = seedLayout("terminal"); // even with terminal active, no provider = no gate
    const onFire = vi.fn();
    render(<ScopedHarness scope="git" onFire={onFire} />); // no provider

    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("re-evaluates when the focused tab changes", () => {
    cleanup = seedLayout("git");
    const onFire = vi.fn();
    render(withProvider(<ScopedHarness scope="git" onFire={onFire} />));

    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });
    expect(onFire).toHaveBeenCalledTimes(1);

    // Switch focused tab away from git → callback must stop firing.
    // act() flushes the React subscription so useHotkeys sees enabled=false.
    act(() => {
      seedLayout("terminal");
    });
    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });
    expect(onFire).toHaveBeenCalledTimes(1);

    // Back to git → fires again
    act(() => {
      seedLayout("git");
    });
    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it("composes with the user-provided enabled flag (AND semantics)", () => {
    cleanup = seedLayout("git");
    const onFire = vi.fn();
    render(withProvider(<ScopedHarness scope="git" onFire={onFire} enabled={false} />));

    fireEvent.keyDown(document.body, { key: "x", metaKey: true, code: "KeyX" });

    expect(onFire).not.toHaveBeenCalled();
  });
});

describe("useScopedGlobalShortcut", () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  it("fires when scope matches focused tab — even from inside a textarea", () => {
    cleanup = seedLayout("git");
    const onFire = vi.fn();
    const { getByTestId } = render(
      withProvider(<GlobalShortcutHarness scope="git" onFire={onFire} withTextarea />),
    );
    getByTestId("ta").focus();

    fireEvent.keyDown(window, { key: "d", ctrlKey: true, code: "KeyD" });

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("does not fire when another tab is focused — fixes the Ctrl+D-in-terminal bug", () => {
    cleanup = seedLayout("terminal");
    const onFire = vi.fn();

    render(withProvider(<GlobalShortcutHarness scope="git" onFire={onFire} />));

    fireEvent.keyDown(window, { key: "d", ctrlKey: true, code: "KeyD" });

    expect(onFire).not.toHaveBeenCalled();
  });
});
