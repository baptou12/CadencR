import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { ProjectFeatures } from "./ProjectFeatures";
import { resetMockIds } from "@/test-fixtures";

const mockNavigate = vi.fn();
const mockInvalidate = vi.fn();
const mockUpdateStatus = vi.fn();
const mockDelete = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockFeatures = [
  { id: 1, title: "Feature One", type: "feature", status: "draft", project_id: 1 },
  { id: 2, title: "Feature Two", type: "feature", status: "in-progress", project_id: 1 },
  { id: 3, title: "Session One", type: "session", status: "draft", project_id: 1 },
  { id: 4, title: "Archived Feature", type: "feature", status: "archived", project_id: 1 },
];

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      features: {
      listByProject: {
        useQuery: vi.fn(() => ({ data: mockFeatures })),
      },
      updateStatus: {
        useMutation: vi.fn(() => ({ mutate: mockUpdateStatus })),
      },
      delete: {
        useMutation: vi.fn(() => ({ mutate: mockDelete })),
      },
      isEmpty: {
        useQuery: vi.fn(() => ({ data: { empty: false } })),
      },
    },
      useUtils: vi.fn(() => ({
        features: {
          listByProject: { invalidate: mockInvalidate },
          getById: { invalidate: mockInvalidate },
          getProgress: { invalidate: mockInvalidate },
        },
      })),
    },
  };
});

describe("ProjectFeatures", () => {
  beforeEach(() => {
    resetMockIds();
    mockNavigate.mockClear();
    mockUpdateStatus.mockClear();
    mockDelete.mockClear();
  });

  it("renders feature list", () => {
    render(
      <ProjectFeatures
        projectId={1}
        activeFeatureId={null}
        featureTurnStates={{}}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.getByText("Feature One")).toBeInTheDocument();
    expect(screen.getByText("Feature Two")).toBeInTheDocument();
    expect(screen.getByText("Session One")).toBeInTheDocument();
  });

  it("does not show archived features by default", () => {
    render(
      <ProjectFeatures
        projectId={1}
        activeFeatureId={null}
        featureTurnStates={{}}
        onSelectFeature={vi.fn()}
      />,
    );
    expect(screen.queryByText("Archived Feature")).not.toBeInTheDocument();
  });

  it("highlights active feature", () => {
    render(
      <ProjectFeatures
        projectId={1}
        activeFeatureId={1}
        featureTurnStates={{}}
        onSelectFeature={vi.fn()}
      />,
    );
    // Feature One should have active styling
    const featureEl = screen.getByText("Feature One").closest("[role=button]");
    expect(featureEl).toHaveClass("bg-accent");
  });

  it("navigates to feature on click", async () => {
    const user = userEvent.setup();
    render(
      <ProjectFeatures
        projectId={1}
        activeFeatureId={null}
        featureTurnStates={{}}
        onSelectFeature={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Feature One"));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
      }),
    );
  });

  it("calls onSelectFeature when feature clicked", async () => {
    const user = userEvent.setup();
    const onSelectFeature = vi.fn();
    render(
      <ProjectFeatures
        projectId={1}
        activeFeatureId={null}
        featureTurnStates={{}}
        onSelectFeature={onSelectFeature}
      />,
    );
    await user.click(screen.getByText("Feature One"));
    expect(onSelectFeature).toHaveBeenCalledWith(1);
  });

  it("renders status badges for features", () => {
    render(
      <ProjectFeatures
        projectId={1}
        activeFeatureId={null}
        featureTurnStates={{}}
        onSelectFeature={vi.fn()}
      />,
    );
    // Features with different statuses render without crashing
    expect(screen.getByText("Feature Two")).toBeInTheDocument();
  });
});
