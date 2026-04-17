import { describe, it, expect, vi, beforeEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, render, screen } from "@/test-utils";
import { AgentSession } from "./AgentSession";
import type { AgentBlockData } from "../AgentBlock";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("@/api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/generated")>()),
  useListModels: vi.fn(() => ({ data: [{ id: "opus", label: "Opus" }] })),
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
          models: [{ id: "opus", label: "Opus", context_window: 200000 }],
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

function getScrollContainer(container: HTMLElement): HTMLDivElement {
  const scrollContainer = container.querySelector(".overflow-auto");
  if (!(scrollContainer instanceof HTMLDivElement)) {
    throw new Error("Scroll container not found");
  }
  return scrollContainer;
}

function setScrollMetrics(
  el: HTMLDivElement,
  { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: clientHeight,
  });
  el.scrollTop = scrollTop;
}

function renderSession(): { container: HTMLElement; scrollContainer: HTMLDivElement; autoScrollButton: HTMLElement } {
  const view = render(
    <AgentSession
      agentType="session"
      blocks={[makeBlock("1", "Hello")]}
      status="running"
      onSend={vi.fn()}
      onStop={vi.fn()}
    />,
  );

  return {
    container: view.container,
    scrollContainer: getScrollContainer(view.container),
    autoScrollButton: screen.getByRole("button", { name: /auto-scroll/i }),
  };
}

describe("AgentSession auto-scroll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the auto-scroll chip and lets the user toggle it", async () => {
    const user = userEvent.setup();
    const { scrollContainer, autoScrollButton } = renderSession();

    setScrollMetrics(scrollContainer, { scrollHeight: 1000, clientHeight: 200, scrollTop: 400 });

    expect(autoScrollButton).toHaveAttribute("aria-pressed", "true");

    await user.click(autoScrollButton);
    expect(autoScrollButton).toHaveAttribute("aria-pressed", "false");

    scrollContainer.scrollTop = 0;
    await user.click(autoScrollButton);
    expect(autoScrollButton).toHaveAttribute("aria-pressed", "true");
    expect(scrollContainer.scrollTop).toBe(800);
  });

  it("re-enables auto-scroll when the user manually reaches the bottom", () => {
    const { scrollContainer, autoScrollButton } = renderSession();

    setScrollMetrics(scrollContainer, { scrollHeight: 1000, clientHeight: 200, scrollTop: 500 });
    fireEvent.scroll(scrollContainer);
    expect(autoScrollButton).toHaveAttribute("aria-pressed", "false");

    scrollContainer.scrollTop = 800;
    fireEvent.scroll(scrollContainer);
    expect(autoScrollButton).toHaveAttribute("aria-pressed", "true");
  });

  it("does not disable auto-scroll for small near-bottom offsets", () => {
    const { scrollContainer, autoScrollButton } = renderSession();

    setScrollMetrics(scrollContainer, { scrollHeight: 1000, clientHeight: 200, scrollTop: 720 });
    fireEvent.scroll(scrollContainer);

    expect(autoScrollButton).toHaveAttribute("aria-pressed", "true");
  });

  it("does not re-enable auto-scroll when the prompt is focused", async () => {
    const user = userEvent.setup();
    const { scrollContainer, autoScrollButton } = renderSession();

    setScrollMetrics(scrollContainer, { scrollHeight: 1000, clientHeight: 200, scrollTop: 500 });
    fireEvent.scroll(scrollContainer);
    expect(autoScrollButton).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("textbox"));
    expect(autoScrollButton).toHaveAttribute("aria-pressed", "false");
  });
});
