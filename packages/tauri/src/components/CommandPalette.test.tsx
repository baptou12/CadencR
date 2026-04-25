import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const generatedMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  createFeature: vi.fn(),
}));

vi.mock("../api/generated", () => ({
  useListProjects: vi.fn(() => ({
    data: [{ id: 1, name: "Test Project", path: "/test/project" }],
  })),
  useListFeatures: vi.fn(() => ({ data: [] })),
  useCreateProject: vi.fn(() => ({ mutate: generatedMocks.createProject })),
  useCreateFeature: vi.fn(() => ({ mutate: generatedMocks.createFeature })),
  getListProjectsQueryKey: vi.fn(() => ["/api/projects"] as const),
  getListFeaturesQueryKey: vi.fn(
    (params?: { project_id?: number }) => ["/api/features", params] as const,
  ),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("CommandPalette", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    onOpenChange.mockClear();
    mockNavigate.mockClear();
    generatedMocks.createProject.mockClear();
    generatedMocks.createFeature.mockClear();
  });

  it("renders when open", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("does not render dialog content when closed", () => {
    render(
      <CommandPalette
        open={false}
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows New Project and New Feature commands", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={1}
        activeFeatureId={null}
      />,
    );
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByText("New Feature")).toBeInTheDocument();
  });

  it("shows Settings command", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    const settingsEls = screen.getAllByText(/Settings/);
    expect(settingsEls.length).toBeGreaterThan(0);
  });

  it("clicking Settings navigates to /settings", async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={null}
        activeFeatureId={null}
      />,
    );
    const settingsEl = screen.getAllByText(/Settings/)[0];
    await user.click(settingsEl);
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/settings" });
  });

  it("shows New Session command", () => {
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        activeProjectId={1}
        activeFeatureId={null}
      />,
    );
    expect(screen.getByText("New Session")).toBeInTheDocument();
  });
});
