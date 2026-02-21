import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";

const mocks = vi.hoisted(() => {
  const useQueryMock = vi.fn(() => ({ data: undefined as unknown, isLoading: false }));
  const useMutationMock = vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));
  const useUtilsMock = vi.fn(() => ({
    diffComments: { list: { invalidate: vi.fn() } },
  }));
  return { useQueryMock, useMutationMock, useUtilsMock };
});

vi.mock("@/trpc", () => {
  const React = require("react");
  return {
    trpc: {
      createClient: vi.fn(() => ({})),
      Provider: ({ children }: { children: unknown }) =>
        React.createElement(React.Fragment, null, children),
      useUtils: mocks.useUtilsMock,
      git: { getDiff: { useQuery: mocks.useQueryMock } },
      diffComments: {
        list: { useQuery: vi.fn(() => ({ data: [] })) },
        create: { useMutation: mocks.useMutationMock },
        update: { useMutation: mocks.useMutationMock },
        delete: { useMutation: mocks.useMutationMock },
      },
    },
  };
});

// Mock @git-diff-view/react
vi.mock("@git-diff-view/react", () => ({
  DiffView: () => <div data-testid="diff-view">DiffView</div>,
  DiffFile: {
    createInstance: vi.fn(() => ({
      initTheme: vi.fn(),
      initRaw: vi.fn(),
      initSyntax: vi.fn(),
      buildSplitDiffLines: vi.fn(),
      buildUnifiedDiffLines: vi.fn(),
      additionLength: 5,
      deletionLength: 2,
    })),
  },
  DiffModeEnum: { Unified: "unified", Split: "split" },
  SplitSide: { old: "old", new: "new" },
}));

vi.mock("@git-diff-view/lowlight", () => ({ highlighter: {} }));
vi.mock("@git-diff-view/react/styles/diff-view.css", () => ({}));
vi.mock("./dracula-diff.css", () => ({}));

import { DiffViewer } from "./DiffViewer";

describe("DiffViewer", () => {
  it("shows loading state", () => {
    mocks.useQueryMock.mockReturnValue({ data: undefined as unknown, isLoading: true });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
  });

  it("shows 'No changes detected' when diff is empty", () => {
    mocks.useQueryMock.mockReturnValue({ data: "" as unknown, isLoading: false });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("No changes detected")).toBeInTheDocument();
  });

  it("renders diff content when data is present", () => {
    const mockDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3
`;
    mocks.useQueryMock.mockReturnValue({ data: mockDiff as unknown, isLoading: false });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
  });

  it("renders split/unified toggle buttons", () => {
    const mockDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
 line1
+line2
`;
    mocks.useQueryMock.mockReturnValue({ data: mockDiff as unknown, isLoading: false });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
  });
});
