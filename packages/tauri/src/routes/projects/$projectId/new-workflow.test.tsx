import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
const mockMutate = vi.fn();
let mockIsLoading = false;

vi.mock("@/api/generated", () => ({
  useCreateFeature: (opts: { onSuccess?: (f: { id: number }) => void }) => ({
    mutate: (body: unknown) => {
      mockMutate(body);
      opts.onSuccess?.({ id: 99 });
    },
    isLoading: mockIsLoading,
  }),
}));

vi.mock("@/components/workflow/PresetPicker", () => ({
  PresetPicker: ({ onSelect }: { onSelect: (id: number | null) => void }) => (
    <div>
      <button onClick={() => onSelect(5)}>Pick Workflow</button>
      <button onClick={() => onSelect(null)}>Pick Legacy</button>
    </div>
  ),
}));

vi.mock("@/components/prompt-editor/PromptEditor", () => {
  const { forwardRef, useImperativeHandle } = require("react");
  return {
    PromptEditor: forwardRef(function MockPromptEditor(
      { onChange, onEnterSend, disabled, placeholder }: {
        onChange?: (t: string) => void;
        onEnterSend?: () => boolean;
        disabled?: boolean;
        placeholder?: string;
      },
      ref: unknown,
    ) {
      useImperativeHandle(ref, () => ({ focus: vi.fn(), clear: vi.fn(), setText: vi.fn(), getText: () => "" }));
      return (
        <textarea
          data-testid="prompt-editor"
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) onEnterSend?.(); }}
        />
      );
    }),
  };
});

vi.mock("@/components/ImageAttachmentButton", () => ({
  ImageAttachmentButton: () => null,
}));

vi.mock("@/components/ImageAttachmentPreview", () => ({
  ImageAttachmentPreview: () => null,
}));

vi.mock("@/hooks/useImageAttachments", () => ({
  useImageAttachments: () => ({
    attachments: [],
    addFiles: vi.fn(),
    removeAttachment: vi.fn(),
    clearAttachments: vi.fn(),
    dragHandlers: {},
    isDragging: false,
  }),
}));

let CapturedComponent: React.ComponentType | null = null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: React.ComponentType }) => {
    CapturedComponent = opts.component;
    return { useParams: () => ({ projectId: "2" }) };
  },
  useNavigate: () => mockNavigate,
}));

// Force module evaluation to capture the component
await import("./new-workflow");

describe("NewWorkflowPage", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockMutate.mockClear();
    mockIsLoading = false;
  });

  function renderPage() {
    if (!CapturedComponent) throw new Error("Component not captured");
    return render(<CapturedComponent />);
  }

  it("shows workflow picker and prompt on same page", () => {
    renderPage();
    expect(screen.getByText("New Workflow")).toBeInTheDocument();
    expect(screen.getByText("Pick Workflow")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-editor")).toBeInTheDocument();
  });

  it("send button is disabled until workflow is selected", () => {
    renderPage();
    const sendBtn = screen.getByRole("button", { name: /send/i });
    expect(sendBtn).toBeDisabled();
  });

  it("prompt is disabled until workflow is selected", () => {
    renderPage();
    expect(screen.getByTestId("prompt-editor")).toBeDisabled();
  });

  it("enables prompt after selecting a workflow", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    expect(screen.getByTestId("prompt-editor")).not.toBeDisabled();
  });

  it("worktree toggle is checked by default", () => {
    renderPage();
    expect(screen.getByText("Use worktree")).toBeInTheDocument();
  });

  it("creates feature with correct params on send", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    const editor = screen.getByTestId("prompt-editor");
    await user.type(editor, "Build a login page");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(mockMutate).toHaveBeenCalledWith({
      project_id: 2,
      type: "ws-feature",
      workflow_definition_id: 5,
    });
  });

  it("navigates to feature with description on success", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    const editor = screen.getByTestId("prompt-editor");
    await user.type(editor, "Build a login page");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "2", featureId: "99" },
        search: expect.objectContaining({ initialDescription: "Build a login page", useWorktree: true }),
      }),
    );
  });

  it("passes null workflow_definition_id for classic", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Legacy"));
    const editor = screen.getByTestId("prompt-editor");
    await user.type(editor, "Something");
    await user.click(screen.getByRole("button", { name: /send/i }));
    expect(mockMutate).toHaveBeenCalledWith({
      project_id: 2,
      type: "ws-feature",
    });
  });
});
