import { act, render } from "@/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useAgentSessionScrollInput } from "./useAgentSessionScrollInput";
import { popResize, pushResize } from "@/lib/resize-coordinator";
import type { ScrollRef } from "./agent-session-scroll-utils";

// The streaming bottom-pin lives in `observeListGrowth`: a MutationObserver on
// Virtuoso's item list that pins `scrollTop = scrollHeight` when the
// conversation grows, gated on bottom-stick / suppression / resize. The global
// Virtuoso test mock renders no item-list node, so the observer is unreachable
// through AgentSession integration tests — we drive the hook's ref directly
// against a hand-built scroller + item-list instead.

const noop = (): void => {};

// Stable ref params (identity must not change across re-renders, or the
// callback ref would detach/reattach the observer).
const params = {
  scrollerElRef: { current: null as HTMLElement | null },
  stickRef: { current: true },
  historyLoadArmedRef: { current: false },
  lastScrollTopRef: { current: 0 },
  userScrollIntentRef: { current: false },
  suppressScrollIntentRef: { current: false },
  armUserScrollIntent: noop,
  setAutoScrollEnabled: noop,
  requestOlderHistory: noop,
};

let scrollRef: ScrollRef;
function Harness(): null {
  scrollRef = useAgentSessionScrollInput(params);
  return null;
}

function buildScroller(
  scrollHeight = 1000,
  clientHeight = 400,
): {
  scroller: HTMLElement;
  list: HTMLElement;
} {
  const scroller = document.createElement("div");
  const list = document.createElement("div");
  list.setAttribute("data-testid", "virtuoso-item-list");
  scroller.appendChild(list);
  document.body.appendChild(scroller);
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, get: () => clientHeight });
  scroller.scrollTop = 0;
  return { scroller, list };
}

// MutationObserver records are delivered on the microtask queue; a macrotask
// tick flushes them.
async function flushMutations(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function growList(list: HTMLElement): void {
  act(() => {
    list.appendChild(document.createElement("div"));
  });
}

describe("useAgentSessionScrollInput — streaming bottom-pin", () => {
  afterEach(() => {
    params.stickRef.current = true;
    params.scrollerElRef.current = null;
    document.body.innerHTML = "";
  });

  it("pins scrollTop to the bottom when the item list grows while stuck", async () => {
    render(<Harness />);
    const { scroller, list } = buildScroller();
    act(() => scrollRef(scroller));

    growList(list);
    await flushMutations();

    expect(scroller.scrollTop).toBe(1000);
  });

  it("does not pin when bottom-stick is disengaged", async () => {
    render(<Harness />);
    const { scroller, list } = buildScroller();
    params.stickRef.current = false;
    act(() => scrollRef(scroller));

    growList(list);
    await flushMutations();

    expect(scroller.scrollTop).toBe(0);
  });

  it("does not pin while a split-pane resize is in flight", async () => {
    render(<Harness />);
    const { scroller, list } = buildScroller();
    act(() => scrollRef(scroller));

    pushResize();
    try {
      growList(list);
      await flushMutations();
      expect(scroller.scrollTop).toBe(0);
    } finally {
      popResize();
    }
  });

  it("disconnects the observer once the scroller detaches", async () => {
    render(<Harness />);
    const { scroller, list } = buildScroller();
    act(() => scrollRef(scroller));
    act(() => scrollRef(null));

    growList(list);
    await flushMutations();

    expect(scroller.scrollTop).toBe(0);
  });
});
