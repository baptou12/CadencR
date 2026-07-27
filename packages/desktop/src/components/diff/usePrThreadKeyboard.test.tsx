import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CommentThread } from "@/api/generated";
import type { GitNavigationAdapter } from "./gitNavigation";
import { usePrThreadKeyboard, type PrThreadKeyboardParams } from "./usePrThreadKeyboard";

function thread(id: string): CommentThread {
  return {
    id,
    outdated: false,
    resolved: false,
    file: `src/${id}.ts`,
    line: 12,
    comments: [
      {
        author: { username: "reviewer" },
        body_markdown: id,
        created_at: "2026-07-24T00:00:00Z",
      },
    ],
  };
}

function setup(overrides: Partial<PrThreadKeyboardParams> = {}) {
  let adapter: GitNavigationAdapter | null = null;
  const params: PrThreadKeyboardParams = {
    threads: [thread("one"), thread("two"), thread("three")],
    register: (next) => {
      adapter = next;
      return () => {
        adapter = null;
      };
    },
    onViewThread: vi.fn(),
    onSelectedChange: vi.fn(),
    selectedThreadIds: new Set<string>(),
    scrollHalfPage: vi.fn(() => true),
    revealThread: vi.fn(),
    ...overrides,
  };
  const view = renderHook((props: PrThreadKeyboardParams) => usePrThreadKeyboard(props), {
    initialProps: params,
  });
  return { view, params, adapter: () => adapter! };
}

describe("usePrThreadKeyboard", () => {
  it("starts at the top on `j` and at the bottom on `k`", () => {
    const down = setup();
    act(() => void down.adapter().moveSelection(1));
    expect(down.view.result.current.focusedThreadId).toBe("one");

    const up = setup();
    act(() => void up.adapter().moveSelection(-1));
    expect(up.view.result.current.focusedThreadId).toBe("three");
  });

  it("wraps around the list", () => {
    const { view, adapter } = setup();
    act(() => void adapter().moveSelection(1));
    act(() => void adapter().moveSelection(-1));
    expect(view.result.current.focusedThreadId).toBe("three");
  });

  it("asks the virtualizer for a thread it has not rendered", () => {
    const revealThread = vi.fn();
    const { adapter } = setup({ revealThread });

    act(() => void adapter().moveSelection(1));

    // Nothing is in the DOM in this harness, so every move is an off-screen
    // move — which is exactly the case that used to leave focus invisible.
    expect(revealThread).toHaveBeenCalledWith(0);
  });

  it("picks the focused thread with `x`, and unpicks an already-picked one", () => {
    const onSelectedChange = vi.fn();
    const { adapter, view, params } = setup({ onSelectedChange });

    act(() => void adapter().moveSelection(1));
    act(() => void adapter().togglePicked?.());
    expect(onSelectedChange).toHaveBeenLastCalledWith("one", true);

    // `x` is a toggle, so it has to read the selection the parent owns rather
    // than a local mirror that would drift the moment a checkbox was clicked.
    view.rerender({ ...params, selectedThreadIds: new Set(["one"]) });
    act(() => void adapter().togglePicked?.());
    expect(onSelectedChange).toHaveBeenLastCalledWith("one", false);
  });

  it("does nothing on `x` before anything is focused", () => {
    const onSelectedChange = vi.fn();
    const { adapter } = setup({ onSelectedChange });

    expect(adapter().togglePicked?.()).toBe(false);
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it("opens the focused thread in the diff", () => {
    const onViewThread = vi.fn();
    const { adapter } = setup({ onViewThread });

    act(() => void adapter().moveSelection(1));
    expect(adapter().open()).toBe(true);
    expect(onViewThread).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });

  it("reports `h` as unhandled with nothing focused, so the key can fall through", () => {
    const { adapter } = setup();
    expect(adapter().back()).toBe(false);

    act(() => void adapter().moveSelection(1));
    expect(adapter().back()).toBe(true);
  });

  it("drops focus when the filter removes the focused thread", () => {
    const { view, adapter, params } = setup();
    act(() => void adapter().moveSelection(1));
    expect(view.result.current.focusedThreadId).toBe("one");

    view.rerender({ ...params, threads: [thread("two"), thread("three")] });

    expect(view.result.current.focusedThreadId).toBeNull();
  });
});
