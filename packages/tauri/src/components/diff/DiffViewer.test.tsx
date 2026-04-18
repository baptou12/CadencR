import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@/test-utils";

const mocks = vi.hoisted(() => {
  const useGetDiffMock = vi.fn(() => ({ data: undefined as unknown, isLoading: false }));
  const useMutationMock = vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));
  return { useGetDiffMock, useMutationMock };
});

vi.mock("@/api/generated", () => ({
  useGetDiff: mocks.useGetDiffMock,
  useGetFileBlobShas: vi.fn(() => ({ data: [] })),
  useGetCommitLog: vi.fn(() => ({ data: { commits: [], is_on_base_branch: true } })),
  useGetFileContent: vi.fn(() => ({ data: undefined })),
  useGetFileContentBatch: vi.fn(() => ({ data: undefined })),
  getGetFileContentQueryKey: vi.fn(() => ["git", "file-content"]),
  useListDiffViewed: vi.fn(() => ({ data: [] })),
  useMarkDiffViewed: mocks.useMutationMock,
  useUnmarkDiffViewed: mocks.useMutationMock,
  useListDiffComments: vi.fn(() => ({ data: [] })),
  useCreateDiffComment: mocks.useMutationMock,
  useUpdateDiffComment: mocks.useMutationMock,
  useDeleteDiffComment: mocks.useMutationMock,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() })),
  };
});

// Mock CodeMirror-based ReadOnlyDiffView
vi.mock("@/components/editor/ReadOnlyDiffView", () => ({
  ReadOnlyDiffView: () => <div data-testid="diff-view">DiffView</div>,
}));

import { DiffViewer } from "./DiffViewer";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiffViewer", () => {
  it("shows loading state", () => {
    mocks.useGetDiffMock.mockReturnValue({ data: undefined as unknown, isLoading: true });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
  });

  it("shows 'No changes detected' when diff is empty", () => {
    mocks.useGetDiffMock.mockReturnValue({ data: { diff: "" } as unknown, isLoading: false });
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
    mocks.useGetDiffMock.mockReturnValue({ data: { diff: mockDiff } as unknown, isLoading: false });
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
    mocks.useGetDiffMock.mockReturnValue({ data: { diff: mockDiff } as unknown, isLoading: false });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
  });

  it("does not emit nested button warnings for file headers", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mockDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
 line1
+line2
`;

    mocks.useGetDiffMock.mockReturnValue({ data: { diff: mockDiff } as unknown, isLoading: false });

    render(<DiffViewer featureId={1} mode="worktree" />);

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("cannot be a descendant of <button>"),
    );
  });
});
