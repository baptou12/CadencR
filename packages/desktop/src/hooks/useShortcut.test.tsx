import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

import { act, fireEvent, render } from "@/test-utils";
import { useShortcutOverridesStore } from "@/lib/shortcuts/overrides";
import { useGlobalShortcutById, useShortcut } from "./useShortcut";

// `test-setup.ts` pins `navigator.platform = "MacIntel"`, so `mod` resolves
// to `meta` and these tests fire `metaKey: true`. Cross-platform coverage
// (mod → ctrl) lives in `lib/shortcuts/resolve.test.ts`.

afterEach(() => {
  useShortcutOverridesStore.getState().resetAll();
});

function Harness({ onFire }: { onFire: () => void }): ReactElement {
  useShortcut("toggle-sidebar", onFire);
  return <div data-testid="harness" tabIndex={0} />;
}

function GlobalHarness({ onFire }: { onFire: () => void }): ReactElement {
  useGlobalShortcutById("shortcuts-help", onFire);
  return <div data-testid="g" tabIndex={0} />;
}

describe("useShortcut", () => {
  it("binds the registry default combo for the given id", () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);

    fireEvent.keyDown(document.body, { key: "b", metaKey: true, code: "KeyB" });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("re-binds when the user overrides the combo (future customization path)", () => {
    const onFire = vi.fn();
    render(<Harness onFire={onFire} />);

    act(() => {
      useShortcutOverridesStore.getState().setOverride("toggle-sidebar", {
        keys: ["mod", "shift", "b"],
      });
    });

    fireEvent.keyDown(document.body, { key: "b", metaKey: true, code: "KeyB" });
    expect(onFire).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, {
      key: "B",
      metaKey: true,
      shiftKey: true,
      code: "KeyB",
    });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("fires from inside a text input (form-tag default = true)", () => {
    const onFire = vi.fn();
    const { container } = render(
      <>
        <Harness onFire={onFire} />
        <input data-testid="ip" />
      </>,
    );
    const input = container.querySelector("input")!;
    input.focus();

    fireEvent.keyDown(input, { key: "b", metaKey: true, code: "KeyB" });
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});

describe("useGlobalShortcutById", () => {
  it("binds the capture-phase listener for the registry default combo", () => {
    const onFire = vi.fn();
    render(<GlobalHarness onFire={onFire} />);

    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("re-binds when the override changes", () => {
    const onFire = vi.fn();
    render(<GlobalHarness onFire={onFire} />);

    act(() => {
      useShortcutOverridesStore.getState().setOverride("shortcuts-help", {
        keys: ["mod", "shift", "h"],
      });
    });

    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(onFire).not.toHaveBeenCalled();

    fireEvent.keyDown(window, {
      key: "h",
      metaKey: true,
      shiftKey: true,
      code: "KeyH",
    });
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
