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

  it("shows workflow picker initially", () => {
    renderPage();
    expect(screen.getByText("Choose a Workflow")).toBeInTheDocument();
    expect(screen.getByText("Pick Workflow")).toBeInTheDocument();
  });

  it("shows title form after picking a workflow", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    expect(screen.getByRole("heading", { name: "Start Workflow" })).toBeInTheDocument();
    expect(screen.getByLabelText("Feature Title")).toBeInTheDocument();
  });

  it("back button returns to picker from form", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    expect(screen.getByRole("heading", { name: "Start Workflow" })).toBeInTheDocument();
    const backButtons = screen.getAllByRole("button");
    const backBtn = backButtons.find((b) => !b.textContent?.includes("Start") && !b.textContent?.includes("Pick"));
    await user.click(backBtn!);
    expect(screen.getByText("Choose a Workflow")).toBeInTheDocument();
  });

  it("start button is disabled when title is empty", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    const startBtn = screen.getByRole("button", { name: /start workflow/i });
    expect(startBtn).toBeDisabled();
  });

  it("creates feature with correct params on submit", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    const input = screen.getByLabelText("Feature Title");
    await user.type(input, "My Feature");
    await user.click(screen.getByRole("button", { name: /start workflow/i }));
    expect(mockMutate).toHaveBeenCalledWith({
      project_id: 2,
      title: "My Feature",
      type: "ws-feature",
      workflow_definition_id: 5,
    });
  });

  it("navigates to feature on success", async () => {
    const { user } = renderPage();
    await user.click(screen.getByText("Pick Workflow"));
    await user.type(screen.getByLabelText("Feature Title"), "Test");
    await user.click(screen.getByRole("button", { name: /start workflow/i }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/features/$featureId",
      params: { projectId: "2", featureId: "99" },
    });
  });
});
