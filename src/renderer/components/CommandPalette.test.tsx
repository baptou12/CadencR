import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { CommandPalette } from "./CommandPalette";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const mockSelectFolder = vi.fn();
const mockCreateProject = vi.fn();
const mockCreateFeature = vi.fn();
const mockCreateSession = vi.fn();
const mockInvalidate = vi.fn();

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
            data: [
              { id: 1, name: "Project Alpha", path: "/alpha" },
              { id: 2, name: "Project Beta", path: "/beta" },
            ],
          })),
        },
        selectFolder: {
          useMutation: vi.fn(() => ({ mutateAsync: mockSelectFolder })),
        },
        create: {
          useMutation: vi.fn(() => ({ mutate: mockCreateProject })),
        },
      },
      features: {
        create: {
          useMutation: vi.fn(() => ({ mutate: mockCreateFeature })),
        },
        createSession: {
          useMutation: vi.fn(() => ({ mutate: mockCreateSession })),
        },
        listByProject: {
          useQuery: vi.fn(() => ({ data: [] })),
        },
      },
      useUtils: vi.fn(() => ({
        projects: {
          list: { invalidate: mockInvalidate },
        },
        features: {
          listByProject: { invalidate: mockInvalidate },
        },
      })),
    },
  };
});

describe("CommandPalette", () => {
  const onOpenChange = vi.fn();

  beforeEach(() => {
    onOpenChange.mockClear();
    mockNavigate.mockClear();
    mockCreateFeature.mockClear();
    mockSelectFolder.mockClear();
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
