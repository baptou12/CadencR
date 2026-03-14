import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ProjectTree } from "./ProjectTree";
import { resetMockIds } from "@/test-fixtures";

const mockNavigate = vi.fn();
const mockInvalidate = vi.fn();
const mockSelectFolder = vi.fn();
const mockCreateProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockCreateFeature = vi.fn();
const mockCreateSession = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../api/generated", () => ({
  useListProjects: vi.fn(() => ({
    data: [
      { id: 1, name: "Alpha Project", path: "/alpha" },
      { id: 2, name: "Beta Project", path: "/beta" },
    ],
  })),
  useCreateProject: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockCreateProject(data);
      opts?.onSuccess?.();
    },
    isLoading: false,
  })),
  useDeleteProject: vi.fn((opts?: { onSuccess?: () => void }) => ({
    mutate: (data: unknown) => {
      mockDeleteProject(data);
      opts?.onSuccess?.();
    },
  })),
  getListProjectsQueryKey: vi.fn(() => ["projects"]),
  useListFeatures: vi.fn(() => ({
    data: [{ id: 10, title: "Feature One", type: "feature", status: "draft", project_id: 1 }],
  })),
  useCreateFeature: vi.fn((opts?: { onSuccess?: (r: unknown) => void }) => ({
    mutate: (data: unknown) => {
      mockCreateFeature(data);
      opts?.onSuccess?.({ id: 99 });
    },
  })),
  useDeleteFeature: vi.fn(() => ({ mutate: vi.fn() })),
  useUpdateFeatureStatus: vi.fn(() => ({ mutate: vi.fn() })),
  getListFeaturesQueryKey: vi.fn((id: number) => ["features", "list", id]),
  useGetFeatureEmpty: vi.fn(() => ({ data: { empty: false } })),
  useGetFeatureTurnStates: vi.fn(() => ({ data: { states: {} } })),
}));

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      projects: {
        selectFolder: {
          useMutation: vi.fn(() => ({
            mutateAsync: mockSelectFolder,
            isLoading: false,
          })),
        },
      },
      useUtils: vi.fn(() => ({})),
    },
  };
});

// Mock ProjectSettingsDialog
vi.mock("./ProjectSettingsDialog", () => ({
  ProjectSettingsDialog: () => null,
}));

describe("ProjectTree", () => {
  beforeEach(() => {
    resetMockIds();
    mockNavigate.mockClear();
    mockCreateFeature.mockClear();
    mockSelectFolder.mockClear();
  });

  it("renders project list", () => {
    render(
      <ProjectTree
        activeProjectId={null}
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getByText("Alpha Project")).toBeInTheDocument();
    expect(screen.getByText("Beta Project")).toBeInTheDocument();
  });

  it("renders Projects heading", () => {
    render(
      <ProjectTree
        activeProjectId={null}
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows add project button", () => {
    render(
      <ProjectTree
        activeProjectId={null}
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });

  it("expands active project to show features", () => {
    render(
      <ProjectTree
        activeProjectId={1}
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getByText("Feature One")).toBeInTheDocument();
  });

  it("toggles project expansion on click", async () => {
    const user = userEvent.setup();
    render(
      <ProjectTree
        activeProjectId={null}
        activeFeatureId={null}
        onSelectFeature={vi.fn()}
      />,
    );
    // Click project button to expand
    await user.click(screen.getByText("Alpha Project"));
    expect(screen.getByText("Feature One")).toBeInTheDocument();
    // Click again to collapse
    await user.click(screen.getByText("Alpha Project"));
    expect(screen.queryByText("Feature One")).not.toBeInTheDocument();
  });
});
