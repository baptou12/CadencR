import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockGetWorkspaceSetting = vi.fn(() => ({ data: { value: "1" }, isSuccess: true }));
  const mockSetWorkspaceSetting = vi.fn(() => ({ mutate: vi.fn(), isLoading: false }));
  return { mockGetWorkspaceSetting, mockSetWorkspaceSetting };
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
vi.mock("../api/generated", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/generated")>()),
  useGetWorkspaceSetting: mocks.mockGetWorkspaceSetting,
  useSetWorkspaceSetting: mocks.mockSetWorkspaceSetting,
  getGetWorkspaceSettingQueryKey: vi.fn((key: string) => ["workspace", "setting", key]),
}));

vi.mock("../components/ModelSelector", () => ({
  ModelSelector: ({ level }: { level: string }) => (
    <div data-testid="model-selector" data-level={level}>
      ModelSelector
    </div>
  ),
}));

import { Route } from "./settings";

function SettingsPage() {
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options
    ?.component;
  if (!Component) return null;
  return <Component />;
}

describe("SettingsPage route", () => {
  beforeEach(() => {
    mocks.mockGetWorkspaceSetting.mockReturnValue({ data: { value: "1" }, isSuccess: true });
  });

  it("renders the settings heading", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("renders agent runtime section", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Agent Runtime")).toBeInTheDocument();
    expect(screen.getByTestId("model-selector")).toBeInTheDocument();
  });

  it("renders agent autonomy section", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Agent Autonomy")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
  });

  it("renders git settings section", () => {
    render(<SettingsPage />);
    expect(screen.getByRole("heading", { name: "Git" })).toBeInTheDocument();
    expect(
      screen.getByText("Configure defaults and behavior for Git actions in the header."),
    ).toBeInTheDocument();
    expect(screen.getByText("--no-ff")).toBeInTheDocument();
  });

  it("renders loader style section", () => {
    render(<SettingsPage />);
    expect(screen.getByText("Loader Style")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose between the default square loader and a discreet animated usage glow.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Usage Glow")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep the current square streaming indicator and standard context usage bar.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Hide the square and let the context usage bar carry a subtle neon pulse while the agent is running.",
      ),
    ).toBeInTheDocument();
  });
});
