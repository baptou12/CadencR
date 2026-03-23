import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  const mockNavigate = vi.fn();
  const mockUseSearch = vi.fn(() => ({}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockProjectsListQuery = vi.fn(() => ({ data: [] as any[], isSuccess: false })) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockFeaturesListQuery = vi.fn(() => ({ data: [] as any[], isSuccess: false })) as any;
  return { mockNavigate, mockUseSearch, mockProjectsListQuery, mockFeaturesListQuery };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (_path: string) => (opts: { component: unknown; validateSearch?: unknown }) => ({
    options: opts,
    useSearch: mocks.mockUseSearch,
    useParams: vi.fn(() => ({})),
  }),
  useNavigate: () => mocks.mockNavigate,
  useRouterState: () => ({ location: { pathname: "/" } }),
  Outlet: () => <div data-testid="outlet" />,
  Link: ({ children, to }: { children: unknown; to: string }) => {
    const React = require("react");
    return React.createElement("a", { href: to }, children);
  },
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: vi.fn() }));

vi.mock("../api/generated", () => ({
  useListProjects: () => mocks.mockProjectsListQuery(),
  getListProjectsQueryKey: vi.fn(() => ["projects"]),
  useListFeatures: () => mocks.mockFeaturesListQuery(),
}));

import { Route } from "./index";

function HomePage() {
  (Route as unknown as { useSearch: typeof mocks.mockUseSearch }).useSearch = mocks.mockUseSearch;
  const Component = (Route as unknown as { options: { component: React.ComponentType } }).options?.component;
  if (!Component) return null;
  return <Component />;
}

describe("HomePage route", () => {
  beforeEach(() => {
    mocks.mockNavigate.mockClear();
    mocks.mockUseSearch.mockReturnValue({});
    mocks.mockProjectsListQuery.mockReturnValue({ data: [], isSuccess: true });
    mocks.mockFeaturesListQuery.mockReturnValue({ data: [], isSuccess: true });
  });

  it("shows 'No projects yet' message when there are no projects", () => {
    render(<HomePage />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("shows 'No features' message when project has no features", () => {
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "Test", path: "/test" }],
      isSuccess: true,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({ data: [], isSuccess: true });
    render(<HomePage />);
    expect(screen.getByText("No features in this project yet")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    mocks.mockProjectsListQuery.mockReturnValue({ data: [], isSuccess: false });
    mocks.mockFeaturesListQuery.mockReturnValue({ data: [], isSuccess: false });
    render(<HomePage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("navigates when project and feature exist", () => {
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "Test", path: "/test" }],
      isSuccess: true,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({
      data: [{ id: 5, title: "Feature 1" }],
      isSuccess: true,
    });
    render(<HomePage />);
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "1", featureId: "5" },
      }),
    );
  });
});
