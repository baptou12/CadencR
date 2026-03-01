import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockGetQuery = vi.fn(() => ({ data: "1" }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockListQueryData = vi.fn(() => ({ data: [] as any[] })) as any;
  const mockSetMutation = vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isLoading: false,
  }));
  const mockRefetch = vi.fn();
  return { mockGetQuery, mockListQueryData, mockSetMutation, mockRefetch };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (opts: { component: unknown }) => ({
    options: opts,
    useSearch: vi.fn(() => ({})),
    useParams: vi.fn(() => ({})),
  }),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/settings" } }),
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));

vi.mock("../trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      useContext: vi.fn(() => ({
        workspace: { get: { invalidate: vi.fn() } },
      })),
      useUtils: vi.fn(() => ({
        workspace: { get: { invalidate: vi.fn() } },
      })),
      workspace: {
        get: { useQuery: mocks.mockGetQuery },
        list: {
          useQuery: () => ({
            data: mocks.mockListQueryData().data,
            refetch: mocks.mockRefetch,
          }),
        },
        set: { useMutation: mocks.mockSetMutation },
      },
      features: {
        getById: { useQuery: vi.fn(() => ({ data: undefined })) },
      },
      projects: {
        list: { useQuery: vi.fn(() => ({ data: [] })) },
      },
    },
  };
});

vi.mock("../components/ModelSelector", () => ({
  ModelSelector: ({ level }: { level: string }) => (
    <div data-testid="model-selector" data-level={level}>
      ModelSelector
    </div>
  ),
}));

import { Route } from "./settings";

function SettingsPage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options?.component;
  if (!Component) return null;
  return <Component />;
}

describe("SettingsPage route", () => {
  beforeEach(() => {
    mocks.mockGetQuery.mockReturnValue({ data: "1" });
    mocks.mockListQueryData.mockReturnValue({ data: [] });
  });

  it("renders the settings heading", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders model configuration section", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Model Configuration")).toBeInTheDocument();
    expect(screen.getByTestId("model-selector")).toBeInTheDocument();
  });

  it("renders agent autonomy section", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Agent Autonomy")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders custom settings section", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Custom Settings")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Value")).toBeInTheDocument();
  });

  it("shows 'No settings stored yet' when list is empty", () => {
    render(<SettingsPage />);
    expect(screen.getByText("No settings stored yet.")).toBeInTheDocument();
  });

  it("displays stored settings", () => {
    mocks.mockListQueryData.mockReturnValue({
      data: [{ key: "my_key", value: "my_value" }],
    });
    render(<SettingsPage />);
    expect(screen.getByText("my_key")).toBeInTheDocument();
    expect(screen.getByText("my_value")).toBeInTheDocument();
  });

  it("allows entering key/value and clicking save", () => {
    const mutate = vi.fn();
    mocks.mockSetMutation.mockReturnValue({ mutate, mutateAsync: vi.fn(), isLoading: false });
    render(<SettingsPage />);
    fireEvent.change(screen.getByPlaceholderText("Key"), { target: { value: "test_key" } });
    fireEvent.change(screen.getByPlaceholderText("Value"), { target: { value: "test_val" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith({ key: "test_key", value: "test_val" });
  });
});
