import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
  type Ref,
} from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@/test-utils";
import { AgentSession } from "./AgentSession";
import type { AgentBlockData } from "../AgentBlock";
import { toast } from "sonner";

interface VirtuosoMockProps {
  data?: AgentBlockData[];
  firstItemIndex?: number;
  itemContent?: (index: number, block: AgentBlockData) => ReactNode;
  components?: {
    Header?: () => ReactNode;
    Footer?: () => ReactNode;
  };
  atBottomStateChange?: (atBottom: boolean) => void;
  startReached?: (index: number) => void;
  followOutput?: (isAtBottom: boolean) => "auto" | "smooth" | false;
  scrollerRef?: (el: HTMLElement | null | Window) => void;
}

interface VirtuosoMockHandle {
  scrollToIndex: ReturnType<typeof vi.fn>;
}

// Captured by the Virtuoso mock so tests can simulate scroll events.
let lastVirtuosoProps: VirtuosoMockProps | null = null;
// Captured scroller element so tests can dispatch real DOM events on it
// (wheel / touchmove / pointerdown) — this is how the scroll hook detects
// user-driven scroll intent.
let lastScrollerEl: HTMLElement | null = null;
// Each render appends the firstItemIndex value seen by Virtuoso so tests can
// observe the decrement that happens after older history is prepended.
let firstItemIndexHistory: number[] = [];
const scrollToIndexMock = vi.fn();

vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function VirtuosoMock(
    props: VirtuosoMockProps,
    ref: Ref<VirtuosoMockHandle>,
  ) {
    lastVirtuosoProps = props;
    if (typeof props.firstItemIndex === "number") {
      firstItemIndexHistory.push(props.firstItemIndex);
    }
    useImperativeHandle(ref, () => ({ scrollToIndex: scrollToIndexMock }), []);
    // Hand the scroller element back to the parent's `scrollerRef` callback
    // exactly like real Virtuoso does, so the scroll hook can attach its
    // user-input listeners. The real component does this in an effect once
    // the scrolling DOM node is mounted; we mirror that timing.
    const scrollerElRef = useRef<HTMLDivElement | null>(null);
    const { scrollerRef } = props;
    useEffect(() => {
      const el = scrollerElRef.current;
      if (!scrollerRef) return;
      scrollerRef(el);
      lastScrollerEl = el;
      return () => {
        scrollerRef(null);
        lastScrollerEl = null;
      };
    }, [scrollerRef]);
    return (
      <div data-testid="virtuoso-mock" ref={scrollerElRef}>
        {props.components?.Header ? <props.components.Header /> : null}
        {props.data?.map((item, i) => (
          <div key={item.id} data-testid={`virtuoso-item-${item.id}`}>
            {props.itemContent?.(i, item)}
          </div>
        ))}
        {props.components?.Footer ? <props.components.Footer /> : null}
      </div>
    );
  }),
}));

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
          label: "Claude Code",
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

/** Simulate Virtuoso reporting a change in bottom-state (user scrolled up/down). */
function fireAtBottomChange(atBottom: boolean): void {
  const cb = lastVirtuosoProps?.atBottomStateChange;
  if (!cb) throw new Error("atBottomStateChange not wired");
  act(() => cb(atBottom));
}

/** Simulate Virtuoso firing startReached (user near top → load older). */
function fireStartReached(): void {
  const cb = lastVirtuosoProps?.startReached;
  if (!cb) throw new Error("startReached not wired");
  act(() => cb(0));
}

/** Read what `followOutput` returns for a given Virtuoso-side at-bottom state. */
function callFollowOutput(virtuosoAtBottom: boolean): "auto" | "smooth" | false {
  const cb = lastVirtuosoProps?.followOutput;
  if (!cb) throw new Error("followOutput not wired");
  return cb(virtuosoAtBottom);
}

/** Dispatch a real DOM event on the captured scroller element. */
function dispatchOnScroller(event: Event): void {
  if (!lastScrollerEl) throw new Error("scroller element not captured");
  act(() => {
    lastScrollerEl?.dispatchEvent(event);
  });
}

describe("AgentSession auto-scroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastVirtuosoProps = null;
    lastScrollerEl = null;
    firstItemIndexHistory = [];
    scrollToIndexMock.mockClear();
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

    const button = getAutoScrollButton();
    expect(button).toHaveAttribute("aria-pressed", "true");

    // The chip is a "scroll to bottom" button — clicking it always asks
    // Virtuoso to scroll to the last item. The pressed state then mirrors
    // whatever atBottom Virtuoso reports.
    await user.click(button);
    expect(scrollToIndexMock).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  });

  // Rule 2: a real wheel-up on the scroller disables auto-scroll. No need
  // for an `atBottomStateChange` round-trip — the input itself is enough.
  it("rule 2: wheel-up on the scroller disables auto-scroll", () => {
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
    dispatchOnScroller(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
    expect(callFollowOutput(true)).toBe(false);
  });

  // Wheel-down (scrolling toward the bottom) must NOT disable. Otherwise
  // any natural read-along scroll would knock follow-mode off.
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

    dispatchOnScroller(new WheelEvent("wheel", { deltaY: 50, bubbles: true }));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  // Rule 1: when Virtuoso reports we're at the bottom, auto-scroll re-engages.
  // This is what the chip-click path also relies on (after the scroll lands).
  it("rule 1: atBottom=true re-enables auto-scroll", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    dispatchOnScroller(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    fireAtBottomChange(true);
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

    dispatchOnScroller(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("textbox"));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
  });

  // The headline bug fix: a content re-measure (Read/Glob/Grep tool result
  // lands → displayBlocks rebuilds → scrollHeight grows before Virtuoso
  // re-anchors) makes Virtuoso emit a phantom `atBottomStateChange(false)`.
  // We must ignore it — only real user input (rule 2) disables follow-mode.
  it("ignores atBottom=false (Virtuoso wobble) entirely", () => {
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

    fireAtBottomChange(false);

    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
    // followOutput must still tell Virtuoso to follow even when Virtuoso
    // itself thinks we're not at the bottom — that's how rule 1 keeps the
    // stream anchored across re-measure wobbles.
    expect(callFollowOutput(false)).toBe("auto");
  });

  // Rule 3: chip click. Re-engages follow-mode synchronously and asks
  // Virtuoso to scroll to the last item.
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

    dispatchOnScroller(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
    expect(callFollowOutput(false)).toBe(false);

    await user.click(getAutoScrollButton());
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
    expect(callFollowOutput(false)).toBe("auto");
    expect(scrollToIndexMock).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  });

  // The "scroll jumps" case the user reported: a single markdown block grows
  // token-by-token. Virtuoso's `followOutput` only fires on count changes,
  // not on in-place content updates that change the last item's *height*. We
  // re-anchor imperatively in a `useLayoutEffect` keyed on the last block's
  // content length.
  it("re-anchors at the bottom when the last block's content grows in place", () => {
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
    };
    const { rerender } = render(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello")]} />);

    // Drop the initial-mount scroll so the assertion targets the streaming
    // re-anchor specifically.
    scrollToIndexMock.mockClear();

    rerender(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello world")]} />);

    expect(scrollToIndexMock).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  });

  // Conversely, if the user has scrolled away (rule 2), an in-place content
  // update must NOT yank the view back down — the chip is the only way back
  // (rule 3).
  it("does not re-anchor when the user has scrolled up", () => {
    const baseProps = {
      agentType: "session" as const,
      status: "agent" as const,
      onSend: vi.fn(),
      onStop: vi.fn(),
    };
    const { rerender } = render(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello")]} />);

    dispatchOnScroller(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));
    scrollToIndexMock.mockClear();

    rerender(<AgentSession {...baseProps} blocks={[makeBlock("1", "Hello world")]} />);

    expect(scrollToIndexMock).not.toHaveBeenCalled();
  });

  it("loads older history when Virtuoso reports the start was reached", async () => {
    const onLoadOlder = vi.fn(async () => {});
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

    fireStartReached();
    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledTimes(1));
  });

  it("does not call onLoadOlder when there is no more history", () => {
    const onLoadOlder = vi.fn(async () => {});
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

    fireStartReached();
    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("shows the loading-older spinner via the Virtuoso header while a fetch is in flight", async () => {
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

    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();

    fireStartReached();
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

    fireStartReached();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to load older messages"));
  });

  it("decrements firstItemIndex by the number of prepended blocks", async () => {
    let resolveLoad: (count: number) => void = () => {};
    const onLoadOlder = vi.fn(
      () =>
        new Promise<number>((resolve) => {
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

    // Capture the index Virtuoso saw before any prepend.
    const initialIndex = firstItemIndexHistory.at(-1);
    expect(typeof initialIndex).toBe("number");

    fireStartReached();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // Resolve with the prepended count: the hook decrements firstItemIndex
    // by exactly that delta, no rerender or rAF needed.
    act(() => resolveLoad(3));

    await waitFor(() => {
      const latest = firstItemIndexHistory.at(-1);
      expect(latest).toBe((initialIndex as number) - 3);
    });
  });

  it("ignores concurrent startReached calls while a load is in flight", async () => {
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

    // Two consecutive startReached events while the first fetch is still in
    // flight must collapse into a single onLoadOlder call.
    fireStartReached();
    fireStartReached();
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    // Resolve the gate so the test does not leak a pending promise.
    act(() => resolveLoad());
    await waitFor(() => expect(onLoadOlder).toHaveBeenCalledTimes(1));
  });
});
