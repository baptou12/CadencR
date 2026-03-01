import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { Sidebar } from "./Sidebar";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: () => ({
    location: { pathname: "/" },
  }),
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

vi.mock("@/logo.svg", () => ({ default: "logo.svg" }));

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      projects: {
        list: {
          useQuery: vi.fn(() => ({
            data: [{ id: 1, name: "My Project", path: "/my-project" }],
          })),
        },
        selectFolder: {
          useMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isLoading: false })),
        },
        create: {
          useMutation: vi.fn(() => ({ mutate: vi.fn(), isLoading: false })),
        },
        delete: {
          useMutation: vi.fn(() => ({ mutate: vi.fn() })),
        },
      },
      features: {
        create: {
          useMutation: vi.fn(() => ({ mutate: vi.fn() })),
        },
        createSession: {
          useMutation: vi.fn(() => ({ mutate: vi.fn() })),
        },
        listByProject: {
          useQuery: vi.fn(() => ({ data: [] })),
        },
      },
      sessions: {
        getFeatureTurnStates: {
          useQuery: vi.fn(() => ({ data: {} })),
        },
      },
      useUtils: vi.fn(() => ({
        projects: { list: { invalidate: vi.fn() } },
        features: { listByProject: { invalidate: vi.fn() } },
      })),
    },
  };
});

// Mock ProjectSettingsDialog
vi.mock("./ProjectSettingsDialog", () => ({
  ProjectSettingsDialog: () => null,
}));

// Mock UsageIndicator
vi.mock("./UsageIndicator", () => ({
  UsageIndicator: () => {
    const React = require("react");
    return React.createElement("div", { "data-testid": "usage-indicator" });
  },
}));

describe("Sidebar", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it("renders the app name", () => {
    render(<Sidebar />);
    expect(screen.getByText("ProductDevR")).toBeInTheDocument();
  });

  it("renders the logo", () => {
    render(<Sidebar />);
    expect(screen.getByAltText("ProductDevR")).toBeInTheDocument();
  });

  it("renders settings link", () => {
    render(<Sidebar />);
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("renders ProjectTree with projects", () => {
    render(<Sidebar />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  it("renders UsageIndicator", () => {
    render(<Sidebar />);
    expect(screen.getByTestId("usage-indicator")).toBeInTheDocument();
  });

  it("renders without crashing on any route", () => {
    render(<Sidebar />);
    expect(screen.getByText("ProductDevR")).toBeInTheDocument();
  });
});
