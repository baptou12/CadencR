import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@/test-utils";
import { AgentSession } from "./AgentSession";
import type { AgentBlockData } from "../AgentBlock";
import { toast } from "sonner";

// Replace the global IntersectionObserver mock with one that does NOT
// auto-fire, so prepend tests have explicit control over the "user reached
// the top" signal.
let lastTopObserver: { fire: () => void } | null = null;
class TopSentinelObserverMock {
  private target: Element | null = null;
  observe = (el: Element): void => {
    this.target = el;
  };
  disconnect = (): void => {
    lastTopObserver = null;
  };
  unobserve = (): void => {};
  constructor(cb: IntersectionObserverCallback) {
    lastTopObserver = {
      fire: () => {
        if (!this.target) return;
        cb(
          [{ isIntersecting: true, target: this.target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      },
    };
  }
}

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("@/api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/generated")>()),
  useGetFeatureWorkingDir: vi.fn(() => ({ data: null })),
  useGetWorkspaceSetting: vi.fn(() => ({ data: null })),
  useListFiles: vi.fn(() => ({ data: [] })),
}));

vi.mock("@/api/agentRuntime", () => ({
  useAgentCatalog: vi.fn(() => ({
    data: {
      default_provider: "claude_code",
      providers: [
        {
          id: "claude_code",
          label: "Claude",
          status: "available",
          models: [{ id: "opus", label: "Opus" }],
          default_model: "opus",
        },
      ],
    },
    isLoading: false,
  })),
}));

vi.mock("@/hooks/usePromptDraft", () => ({
  usePromptDraft: vi.fn(() => ({ saveDraft: vi.fn(), initialDraft: null })),
}));

vi.mock("@/hooks/usePromptHistory", () => ({
  usePromptHistory: vi.fn(() => ({
    addEntry: vi.fn(),
    history: [],
    historyIndex: -1,
    navigateUp: vi.fn(() => null),
    navigateDown: vi.fn(() => null),
    resetNavigation: vi.fn(),
  })),
}));

vi.mock("@/hooks/useImageAttachments", () => ({
  useImageAttachments: vi.fn(() => ({
    attachments: [],
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    dragHandlers: {},
    isDragging: false,
  })),
}));

function makeBlock(id: string, content: string): AgentBlockData {
  return { id, type: "text", content };
}

function getAutoScrollButton(): HTMLElement {
  return screen.getByRole("button", { name: /auto-scroll/i });
}

function getScroller(): HTMLElement {
  return screen.getByTestId("agent-stream-scroller");
}

function stubGeometry(el: HTMLElement, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => clientHeight });
}

function dispatchScroll(el: HTMLElement, scrollTop: number): void {
  el.scrollTop = scrollTop;
  act(() => {
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

/** Simulate a real wheel-up: wheel listener disengages stick synchronously. */
function userWheelUp(el: HTMLElement, scrollTop: number): void {
  act(() => {
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
  });
  dispatchScroll(el, scrollTop);
}

describe("AgentSession auto-scroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastTopObserver = null;
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      value: TopSentinelObserverMock,
    });
  });

  it("shows the auto-scroll chip and scrolls to bottom on click", async () => {
    const user = userEvent.setup();
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    scroller.scrollTop = 0;

    await user.click(getAutoScrollButton());
    expect(scroller.scrollTop).toBe(1000);
  });

  // Rule 2: a real wheel-up disables auto-scroll synchronously, before the
  // next streaming layout effect can re-anchor.
  it("rule 2: wheel-up disables auto-scroll", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");

    userWheelUp(scroller, 100);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
  });

  // Regression: wheeling up on a short / empty conversation (content fits
  // in the viewport, nothing to scroll) must NOT disable auto-scroll. The
  // earlier behavior killed stick on the very first idle wheel, so by the
  // time the chat grew past the viewport new tokens landed off-screen.
  it("rule 2: wheel-up does not disable auto-scroll when content fits in the viewport", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    // Content fits — scrollHeight <= clientHeight, no scrolling possible.
    stubGeometry(scroller, 200, 400);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");

    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
    });
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  // Wheel-down (scrolling toward the bottom) must NOT disable.
  it("rule 2: wheel-down does not disable auto-scroll", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    act(() => {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 50, bubbles: true }));
    });
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  // Rule 1: scrolling back into the bottom band re-enables auto-scroll.
  it("rule 1: scrolling back into the bottom band re-enables auto-scroll", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    userWheelUp(scroller, 100);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    // 1000 - 590 - 400 = 10px from bottom < 16 threshold → re-engages.
    dispatchScroll(scroller, 590);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("does not re-enable auto-scroll when the prompt is focused", async () => {
    const user = userEvent.setup();
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    userWheelUp(scroller, 100);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("textbox"));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
  });

  // Rule 3: chip click re-engages follow-mode and scrolls to bottom.
  it("rule 3: chip click re-engages follow-mode and scrolls to bottom", async () => {
    const user = userEvent.setup();
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    userWheelUp(scroller, 100);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    await user.click(getAutoScrollButton());
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
    expect(scroller.scrollTop).toBe(1000);
  });

  // Headline bug: the last block grows token-by-token. The scroll hook
  // re-anchors via `useLayoutEffect` keyed on the last block's content length.
  it("re-anchors at the bottom when the last block's content grows in place", () => {
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
    };
    const { rerender } = render(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello")]} />);

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    scroller.scrollTop = 0;

    rerender(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello world")]} />);
    expect(scroller.scrollTop).toBe(1000);
  });

  // Regression: with Virtuoso `customScrollParent`, item measurement settles
  // asynchronously. A programmatic `scrollTop = scrollHeight` fires its scroll
  // event AFTER Virtuoso has expanded the content, so the stale `scrollTop`
  // reads as below-threshold against the new `scrollHeight`. Older symmetric
  // `onScroll` would call `setAutoScrollEnabled(false)` here, and the next
  // ResizeObserver re-anchor would be skipped — the user would see content
  // landing off-screen even though the chip looked engaged. The current
  // implementation only disengages when `scrollTop` actually decreased.
  it("does not disengage stick when a programmatic re-anchor echo arrives after content grew", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const scroller = getScroller();
    // We were at the bottom of a 1000px-tall list (scrollTop=600).
    stubGeometry(scroller, 1000, 400);
    dispatchScroll(scroller, 600);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");

    // Simulate Virtuoso settling: content grew from 1000 to 1400 without any
    // user gesture. The next scroll event arrives with the OLD `scrollTop`
    // (600) against the NEW `scrollHeight` (1400). distance = 400, > 16.
    // `scrollTop` did not decrease — stick must stay engaged so the next
    // ResizeObserver pass re-anchors to the new bottom.
    stubGeometry(scroller, 1400, 400);
    act(() => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  // Conversely, if the user has scrolled away (rule 2), an in-place content
  // update must NOT yank the view back down — the chip is the only way back.
  it("does not re-anchor when the user has scrolled up", () => {
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
    };
    const { rerender } = render(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello")]} />);

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    userWheelUp(scroller, 50);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    rerender(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello world")]} />);
    expect(scroller.scrollTop).toBe(50);
  });

  it("loads older history when the top sentinel becomes visible", async () => {
    const onLoadOlder = vi.fn(async () => 0);
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
        hasMore
        onLoadOlder={onLoadOlder}
      />,
    );

    stubGeometry(getScroller(), 1000, 400);
    expect(lastTopObserver).not.toBeNull();
    act(() => lastTopObserver!.fire());

    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledTimes(1));
  });

  it("does not call onLoadOlder when there is no more history", () => {
    const onLoadOlder = vi.fn(async () => 0);
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
        hasMore={false}
        onLoadOlder={onLoadOlder}
      />,
    );

    expect(lastTopObserver).not.toBeNull();
    act(() => lastTopObserver!.fire());
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("shows the loading-older spinner while a fetch is in flight", async () => {
    let resolveLoad: () => void = () => {};
    const onLoadOlder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { container } = render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
        hasMore
        onLoadOlder={onLoadOlder}
      />,
    );

    stubGeometry(getScroller(), 1000, 400);
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    act(() => lastTopObserver!.fire());
    await waitFor(() => {
      expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    });

    act(() => resolveLoad());
    await waitFor(() => {
      expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
    });
  });

  it("shows a toast when loading older history fails", async () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
        hasMore
        onLoadOlder={vi.fn(async () => {
          throw new Error("boom");
        })}
      />,
    );

    stubGeometry(getScroller(), 1000, 400);
    act(() => lastTopObserver!.fire());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to load older messages"));
  });

  // The chat-app prepend-restore pattern: capture scrollHeight/scrollTop
  // when the loader fires, then after the prepended blocks render, restore
  // anchor via `newScrollHeight − prevScrollHeight + prevScrollTop`. The
  // user stays glued to the same content.
  it("preserves the user's scroll position after older messages are prepended", async () => {
    let resolveLoad: () => void = () => {};
    const onLoadOlder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
      hasMore: true,
      onLoadOlder,
    };

    const { rerender } = render(<AgentSession {...baseProps} blocks={[makeBlock("1", "Old")]} />);
    const scroller = getScroller();
    // Reading 80px from the top of a 600px-tall list. WheelUp also disengages
    // stick so the layout effect doesn't pull us back to the bottom on the
    // next render.
    stubGeometry(scroller, 600, 200);
    userWheelUp(scroller, 80);

    act(() => lastTopObserver!.fire());
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // Older blocks land at the front. scrollHeight grows from 600 to 1000.
    // newScrollTop = 1000 − 600 + 80 = 480.
    act(() => resolveLoad());
    stubGeometry(scroller, 1000, 200);
    rerender(
      <AgentSession
        {...baseProps}
        blocks={[makeBlock("0a", ""), makeBlock("0b", ""), makeBlock("1", "Old")]}
      />,
    );

    await waitFor(() => {
      expect(scroller.scrollTop).toBe(480);
    });
  });

  // Conversation switch: the same `AgentSession` instance is reused when the
  // user navigates to a different session (the route only swaps params).
  // Stick state must reset to "engaged" so the new conversation lands at the
  // bottom — without this, a "scrolled up" state from the previous
  // conversation leaks into the next one and the user lands mid-history.
  it("re-engages stick and pins to bottom when the conversation switches", () => {
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
    };
    const { rerender } = render(
      <AgentSession {...baseProps} wsSessionId="A" blocks={[makeBlock("a1", "First")]} />,
    );

    const scroller = getScroller();
    stubGeometry(scroller, 1000, 400);
    userWheelUp(scroller, 100);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    // Switch to a different conversation. The reset effect runs in the same
    // commit as the blocks swap, so the new conversation pins to its bottom.
    stubGeometry(scroller, 800, 400);
    rerender(<AgentSession {...baseProps} wsSessionId="B" blocks={[makeBlock("b1", "Second")]} />);

    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
    expect(scroller.scrollTop).toBe(800);
  });

  // Regression: while the new conversation's content lays out asynchronously,
  // `scrollHeight` can shrink relative to the previous conversation. The
  // browser clamps `scrollTop` downward and fires a scroll event whose
  // `scrollTop` is less than the value we just pushed. The direction-aware
  // `onScroll` would otherwise read that clamp as the user scrolling up; the
  // swap window must suppress that disengage so the user lands at the bottom.
  it("does not disengage stick on a scrollHeight-shrink clamp during a conversation swap", () => {
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
    };
    const { rerender } = render(
      <AgentSession {...baseProps} wsSessionId="A" blocks={[makeBlock("a1", "First")]} />,
    );

    const scroller = getScroller();
    // Land at the bottom of conversation A (tall content).
    stubGeometry(scroller, 2000, 400);
    dispatchScroll(scroller, 1600);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");

    // Switch to a shorter conversation B. The swap reset pins scrollTop to
    // scrollHeight=500 → 500.
    stubGeometry(scroller, 500, 400);
    rerender(<AgentSession {...baseProps} wsSessionId="B" blocks={[makeBlock("b1", "Short")]} />);
    expect(scroller.scrollTop).toBe(500);

    // Simulate the browser's post-swap clamp echo: a scroll event arrives
    // with the smaller `scrollTop` against the new `scrollHeight`. Pre-fix,
    // this read as the user scrolling up and disengaged stick.
    dispatchScroll(scroller, 100);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("collapses concurrent intersection fires while a load is in flight", async () => {
    let resolveLoad: () => void = () => {};
    const onLoadOlder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );

    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
        hasMore
        onLoadOlder={onLoadOlder}
      />,
    );

    stubGeometry(getScroller(), 1000, 400);
    act(() => lastTopObserver!.fire());
    act(() => lastTopObserver!.fire());
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    act(() => resolveLoad());
    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledTimes(1));
  });
});
