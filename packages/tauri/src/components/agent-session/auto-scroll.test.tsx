import { forwardRef, useImperativeHandle, type ReactNode, type Ref } from "react";
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
}

interface VirtuosoMockHandle {
  scrollToIndex: ReturnType<typeof vi.fn>;
}

// Captured by the Virtuoso mock so tests can simulate scroll events.
let lastVirtuosoProps: VirtuosoMockProps | null = null;
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
    return (
      <div data-testid="virtuoso-mock">
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

describe("AgentSession auto-scroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastVirtuosoProps = null;
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

  it("disables auto-scroll when the user scrolls away from the bottom", () => {
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
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("re-enables auto-scroll when the user reaches the bottom again", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="agent"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    fireAtBottomChange(false);
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

    fireAtBottomChange(false);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("textbox"));
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
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
