import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import React from "react";

const mocks = vi.hoisted(() => {
  interface MockQueryResult<TData> {
    data: TData;
    isSuccess: boolean;
    error: Error | null;
  }

  interface MockSettingQueryResult {
    data: { value: string } | undefined;
    isLoading: boolean;
    error: Error | null;
  }

  const mockNavigate = vi.fn();
  const mockUseSearch = vi.fn(() => ({}));
  const mockProjectsListQuery = vi.fn<() => MockQueryResult<unknown[]>>(() => ({ data: [], isSuccess: false, error: null }));
  const mockFeaturesListQuery = vi.fn<() => MockQueryResult<unknown[]>>(() => ({ data: [], isSuccess: false, error: null }));
  const mockLastFeatureQuery = vi.fn<() => MockSettingQueryResult>(() => ({ data: undefined, isLoading: false, error: null }));
  return { mockNavigate, mockUseSearch, mockProjectsListQuery, mockFeaturesListQuery, mockLastFeatureQuery };
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
  useGetWorkspaceSetting: () => mocks.mockLastFeatureQuery(),
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
    mocks.mockLastFeatureQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });
    mocks.mockProjectsListQuery.mockReturnValue({ data: [], isSuccess: true, error: null });
    mocks.mockFeaturesListQuery.mockReturnValue({ data: [], isSuccess: true, error: null });
  });

  it("shows 'No projects yet' message when there are no projects", () => {
    render(<HomePage />);
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("shows 'No features' message when project has no features", () => {
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "Test", path: "/test" }],
      isSuccess: true,
      error: null,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({ data: [], isSuccess: true, error: null });
    render(<HomePage />);
    expect(screen.getByText("No features in this project yet")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    mocks.mockProjectsListQuery.mockReturnValue({ data: [], isSuccess: false, error: null });
    mocks.mockFeaturesListQuery.mockReturnValue({ data: [], isSuccess: false, error: null });
    render(<HomePage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows a startup error when initial queries fail", () => {
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [],
      isSuccess: false,
      error: new Error("Request failed with status code 401"),
    });
    render(<HomePage />);
    expect(screen.getByText("Failed to load workspace")).toBeInTheDocument();
    expect(screen.getByText("Request failed with status code 401")).toBeInTheDocument();
  });

  it("navigates when project and feature exist", () => {
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "Test", path: "/test" }],
      isSuccess: true,
      error: null,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({
      data: [{ id: 5, title: "Feature 1" }],
      isSuccess: true,
      error: null,
    });
    render(<HomePage />);
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "1", featureId: "5" },
      }),
    );
  });

  it("navigates to saved last-opened feature on startup", () => {
    mocks.mockLastFeatureQuery.mockReturnValue({
      data: { value: JSON.stringify({ projectId: 2, featureId: 10 }) },
      isLoading: false,
      error: null,
    });
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "P1", path: "/p1" }, { id: 2, name: "P2", path: "/p2" }],
      isSuccess: true,
      error: null,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({
      data: [{ id: 10, title: "Saved Feature" }, { id: 11, title: "Other" }],
      isSuccess: true,
      error: null,
    });
    render(<HomePage />);
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "2", featureId: "10" },
      }),
    );
  });

  it("falls back to first feature when saved feature no longer exists", () => {
    mocks.mockLastFeatureQuery.mockReturnValue({
      data: { value: JSON.stringify({ projectId: 1, featureId: 999 }) },
      isLoading: false,
      error: null,
    });
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "P1", path: "/p1" }],
      isSuccess: true,
      error: null,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({
      data: [{ id: 5, title: "Feature 1" }],
      isSuccess: true,
      error: null,
    });
    render(<HomePage />);
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "1", featureId: "5" },
      }),
    );
  });

  it("falls back to first feature when no saved setting exists", () => {
    mocks.mockLastFeatureQuery.mockReturnValue({ data: undefined, isLoading: false, error: null });
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "P1", path: "/p1" }],
      isSuccess: true,
      error: null,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({
      data: [{ id: 5, title: "Feature 1" }],
      isSuccess: true,
      error: null,
    });
    render(<HomePage />);
    expect(mocks.mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "1", featureId: "5" },
      }),
    );
  });

  it("does not navigate while last-feature setting is still loading", () => {
    mocks.mockLastFeatureQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    mocks.mockProjectsListQuery.mockReturnValue({
      data: [{ id: 1, name: "P1", path: "/p1" }],
      isSuccess: true,
      error: null,
    });
    mocks.mockFeaturesListQuery.mockReturnValue({
      data: [{ id: 5, title: "Feature 1" }],
      isSuccess: true,
      error: null,
    });
    render(<HomePage />);
    expect(mocks.mockNavigate).not.toHaveBeenCalled();
  });
});
