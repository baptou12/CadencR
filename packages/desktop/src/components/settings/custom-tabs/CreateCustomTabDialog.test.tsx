import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test-utils";
import { serviceError } from "./custom-tabs-fixtures";
import { CreateCustomTabDialog, MAX_NAME_LENGTH } from "./CreateCustomTabDialog";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(() => Promise.resolve()),
  authoring: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock("@/api/generated", async (importOriginal) => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    ...(await importOriginal<typeof import("@/api/generated")>()),
    usePluginTabAuthoring: () => useMutation({ mutationFn: mocks.authoring }),
  };
});

const WORKSPACE = { plugin_id: "graph", project_id: 4, feature_id: 9, dir: "/tabs/graph" };

describe("CreateCustomTabDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a name and bounds both fields", () => {
    render(<CreateCustomTabDialog onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Create custom tab" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toHaveAttribute("maxLength", String(MAX_NAME_LENGTH));
    expect(screen.getByLabelText(/Description/)).toHaveAttribute("maxLength", "280");
  });

  it("creates the tab and opens its conversation", async () => {
    mocks.authoring.mockResolvedValue(WORKSPACE);
    const onClose = vi.fn();
    const { user } = render(<CreateCustomTabDialog onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "  Changed files graph ");
    await user.type(screen.getByLabelText(/Description/), "Files this feature changed.");
    await user.click(screen.getByRole("button", { name: "Create custom tab" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.authoring.mock.calls[0]?.[0]).toEqual({
      data: { name: "Changed files graph", description: "Files this feature changed." },
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Custom tab created", expect.any(Object));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/projects/$projectId/features/$featureId",
      params: { projectId: "4", featureId: "9" },
    });
  });

  it("shows the service's refusal inline", async () => {
    mocks.authoring.mockRejectedValue(
      serviceError(400, "PLUGIN_TAB_NAME_INVALID", "name must be 1–64 characters"),
    );
    const { user } = render(<CreateCustomTabDialog onClose={vi.fn()} />);
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByRole("button", { name: "Create custom tab" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("name must be 1–64 characters");
    expect(screen.queryByRole("button", { name: "Retry setup" })).not.toBeInTheDocument();
  });

  it("hands a half-made tab over to its card's Retry setup", async () => {
    const message =
      "custom tab `graph` was created at /tabs/graph, but its project could not be prepared: busy";
    mocks.authoring.mockRejectedValue(
      serviceError(409, "PLUGIN_TAB_PROJECT_SETUP_FAILED", message),
    );
    const onClose = vi.fn();
    const { user } = render(<CreateCustomTabDialog onClose={onClose} />);
    await user.type(screen.getByLabelText("Name"), "Graph");
    await user.click(screen.getByRole("button", { name: "Create custom tab" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.toastError).toHaveBeenCalledWith(message, {
      description: expect.stringContaining("Retry setup"),
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
