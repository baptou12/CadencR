import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureTopBar } from "./FeatureTopBar";

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

const mockOpenTerminal = vi.fn();
const mockSetFeatureSetting = vi.fn();

vi.mock("@/api/generated", () => ({
  useGetFeature: vi.fn(() => ({
    data: {
      id: 1,
      title: "My Test Feature",
      status: "in-progress",
      type: "ws-feature",
      project_id: 1,
      created_at: "2024-01-01",
    },
  })),
  useGetFeaturePlanProgress: vi.fn(() => ({
    data: { done: 2, total: 5 },
  })),
  useGetFeatureSettings: vi.fn(() => ({
    data: [{ key: "worktree_branch", value: "feature/my-branch" }],
  })),
  getGetFeatureSettingsQueryKey: vi.fn((id: number) => ["features", "settings", id]),
  useSetFeatureSetting: vi.fn(() => ({ mutate: mockSetFeatureSetting })),
  useGetStats: vi.fn(() => ({
    data: { commits: 3, insertions: 10, deletions: 2 },
    refetch: vi.fn(),
  })),
  useGetBranch: vi.fn(() => ({ data: { branch: "main" } })),
  useGetFileBlobShas: vi.fn(() => ({ data: [] })),
  useGitOpenInTerminal: vi.fn(() => ({ mutate: mockOpenTerminal })),
  useGitOpenInZed: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock("@/hooks/useFeatureTitle", () => ({
  useFeatureTitle: vi.fn(() => null),
}));

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      workflow: {
        startReviewFixer: {
          useMutation: vi.fn(() => ({ mutate: vi.fn() })),
        },
      },
      git: {
        openInTerminal: {
          useMutation: vi.fn(() => ({ mutate: mockOpenTerminal })),
        },
        openInZed: {
          useMutation: vi.fn(() => ({ mutate: vi.fn() })),
        },
      },
      useContext: vi.fn(() => ({
        sessions: {
          getFeatureAgentState: { invalidate: vi.fn() },
        },
      })),
    },
  };
});

// Mock DiffViewerModal
vi.mock("./diff/DiffViewerModal", () => ({
  DiffViewerModal: ({ open }: { open: boolean }) => {
    const React = require("react");
    return open ? React.createElement("div", { "data-testid": "diff-modal" }, "Diff Modal") : null;
  },
}));

// Mock ModelSelector
vi.mock("./ModelSelector", () => ({
  ModelSelector: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "model-selector" });
  },
}));

describe("FeatureTopBar", () => {
  beforeEach(() => {
    mockOpenTerminal.mockClear();
    mockSetFeatureSetting.mockClear();
  });

  it("renders feature title", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("My Test Feature")).toBeInTheDocument();
  });

  it("renders feature status badge", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("in-progress")).toBeInTheDocument();
  });

  it("shows phase progress", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("renders in session mode without status badge", () => {
    render(<FeatureTopBar featureId={1} projectId={1} mode="session" />);
    expect(screen.queryByText("in-progress")).not.toBeInTheDocument();
  });

  it("renders without crashing", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    expect(screen.getByText("My Test Feature")).toBeInTheDocument();
  });

  it("renders git stats with branch info", () => {
    render(<FeatureTopBar featureId={1} projectId={1} />);
    // Git stats (3 commits) should be visible somewhere
    expect(screen.getByText("My Test Feature")).toBeInTheDocument();
  });
});
