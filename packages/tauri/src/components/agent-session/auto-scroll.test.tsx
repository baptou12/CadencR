import { forwardRef, useImperativeHandle, type ReactNode, type Ref } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@/test-utils";
import { AgentSession } from "./AgentSession";
import type { AgentBlockData } from "../AgentBlock";
import { toast } from "sonner";

interface VirtuosoMockProps {
  data?: AgentBlockData[];
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
const scrollToIndexMock = vi.fn();

vi.mock("react-virtuoso", () => ({
  Virtuoso: forwardRef(function VirtuosoMock(
    props: VirtuosoMockProps,
    ref: Ref<VirtuosoMockHandle>,
  ) {
    lastVirtuosoProps = props;
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
    scrollToIndexMock.mockClear();
  });

  it("shows the auto-scroll chip and lets the user toggle it", async () => {
    const user = userEvent.setup();
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="running"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const button = getAutoScrollButton();
    expect(button).toHaveAttribute("aria-pressed", "true");

    // Toggle off
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");

    // Toggle back on → should request a scroll-to-bottom via Virtuoso
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(scrollToIndexMock).toHaveBeenCalledWith({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  });

  it("re-enables auto-scroll when the user manually reaches the bottom", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="running"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    fireAtBottomChange(false);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");

    fireAtBottomChange(true);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("disables auto-scroll when the user scrolls away from the bottom", () => {
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="running"
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "true");
    fireAtBottomChange(false);
    expect(getAutoScrollButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("loads older history when Virtuoso reports the start was reached", async () => {
    const onLoadOlder = vi.fn(async () => {});
    render(
      <AgentSession
        agentType="session"
        blocks={[makeBlock("1", "Hello")]}
        status="running"
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
        status="running"
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
        status="running"
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
        status="running"
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
});
