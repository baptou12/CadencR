import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, render, screen, within } from "@/test-utils";
import type { FileDiffSection } from "@/lib/parse-unified-diff";

const singleFileDiff = `diff --git a/src/foo.ts b/src/foo.ts
index abc..def 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,1 +1,2 @@
 line1
+line2
`;

const fooFile = {
  file: "src/foo.ts",
  status: "M",
  additions: 1,
  deletions: 1,
  is_staged: false,
  stage_state: "unstaged" as const,
};

const fooSection: FileDiffSection = {
  oldFileName: "src/foo.ts",
  newFileName: "src/foo.ts",
  hunks: [singleFileDiff],
};

const mocks = vi.hoisted(() => {
  const useGetChangedFilesMock = vi.fn(
    () =>
      ({ data: [] as unknown[], isLoading: false }) as {
        data: unknown[];
        isLoading: boolean;
        isError?: boolean;
        error?: unknown;
      },
  );
  const useMutationMock = vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));
  const useGetFileContentMock = vi.fn(() => ({ data: undefined }));
  const useGetFileBlobShasMock = vi.fn<() => { data: unknown[] }>(() => ({ data: [] }));
  const useListDiffViewedMock = vi.fn<() => { data: unknown[] }>(() => ({ data: [] }));
  // Stands in for the lazy per-file diff fetch. Returns the section only when
  // the row is enabled (expanded + on screen), mirroring the real hook.
  const useFileDiffSectionMock = vi.fn(({ enabled }: { enabled: boolean }) => ({
    section: enabled ? fooSection : null,
    isLoading: false,
    errorMessage: null,
  }));
  const patchDiffViewMock = vi.fn(({ patch }: { patch: string }) => (
    <div data-testid="patch-diff-view" data-patch={patch}>
      PatchDiffView
    </div>
  ));
  const persistFileListCollapsedMock = vi.fn();
  const persistTreeDisplayModeMock = vi.fn();
  const useTreeDisplaySettingMock = vi.fn(() => ({
    displayMode: "tree" as const,
    setDisplayMode: persistTreeDisplayModeMock,
    isPending: false,
  }));
  const shortcutCallbacks = new Map<string, (event: KeyboardEvent) => void>();
  const toastInfo = vi.fn();
  const useDebouncedSettingMock = vi.fn<
    (
      key: string,
      debounceMs?: number,
    ) => {
      value: string | null;
      setValue: typeof persistFileListCollapsedMock;
      isLoading?: boolean;
    }
  >(() => ({
    value: null as string | null,
    setValue: persistFileListCollapsedMock,
  }));
  return {
    useGetChangedFilesMock,
    useMutationMock,
    useGetFileContentMock,
    useGetFileBlobShasMock,
    useListDiffViewedMock,
    useFileDiffSectionMock,
    patchDiffViewMock,
    persistFileListCollapsedMock,
    persistTreeDisplayModeMock,
    useTreeDisplaySettingMock,
    useDebouncedSettingMock,
    shortcutCallbacks,
    toastInfo,
  };
});

vi.mock("sonner", () => ({
  toast: { info: mocks.toastInfo, success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useShortcut", () => ({
  useScopedGlobalShortcutById: (id: string, callback: (event: KeyboardEvent) => void): void => {
    mocks.shortcutCallbacks.set(id, callback);
  },
}));

vi.mock("@/api/generated", () => ({
  FileStageState: {
    not_applicable: "not_applicable",
    untracked: "untracked",
    unstaged: "unstaged",
    staged: "staged",
    both: "both",
    conflicted: "conflicted",
  },
  ConflictKind: { dd: "dd", au: "au", ud: "ud", ua: "ua", du: "du", aa: "aa", uu: "uu" },
  useGetChangedFiles: mocks.useGetChangedFilesMock,
  useGetFileBlobShas: mocks.useGetFileBlobShasMock,
  useGetFileContent: mocks.useGetFileContentMock,
  // Orval emits a mutation hook for batch endpoints — mirror the mutation
  // shape so call sites that read `.mutate` and `.data` don't blow up.
  useGetFileContentBatch: mocks.useMutationMock,
  getGetFileContentQueryKey: vi.fn(() => ["git", "file-content"]),
  getListDiffViewedQueryKey: vi.fn((id?: number) => ["/api/features", id, "diff-viewed"]),
  getListDiffCommentsQueryKey: vi.fn((id?: number) => ["/api/features", id, "diff-comments"]),
  useListDiffViewed: mocks.useListDiffViewedMock,
  useMarkDiffViewed: mocks.useMutationMock,
  useUnmarkDiffViewed: mocks.useMutationMock,
  useListDiffComments: vi.fn(() => ({ data: [] })),
  useCreateDiffComment: mocks.useMutationMock,
  useUpdateDiffComment: mocks.useMutationMock,
  useDeleteDiffComment: mocks.useMutationMock,
  useStageFile: mocks.useMutationMock,
  useResetFile: mocks.useMutationMock,
}));

vi.mock("./useFileDiffSection", () => ({
  useFileDiffSection: mocks.useFileDiffSectionMock,
}));

// Treat every row as on-screen so lazy per-file diffs load in tests.
vi.mock("@/hooks/useInViewport", () => ({
  useInViewport: () => ({ setRef: () => {}, inView: true }),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual("@tanstack/react-query");
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() })),
  };
});

vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: (key: string, debounceMs?: number) =>
    mocks.useDebouncedSettingMock(key, debounceMs),
}));

vi.mock("./useGitDiffTreeDisplaySetting", () => ({
  useGitDiffTreeDisplaySetting: mocks.useTreeDisplaySettingMock,
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({ theme: { id: "dracula", appearance: "dark" } }),
}));

vi.mock("./PatchDiffView", () => ({
  PatchDiffView: (props: Parameters<typeof mocks.patchDiffViewMock>[0]) =>
    mocks.patchDiffViewMock(props),
}));

import { DiffViewer } from "./DiffViewer";

/** Default: the changed-files list contains one modified file. */
function withFooFile(): void {
  mocks.useGetChangedFilesMock.mockReturnValue({ data: [fooFile], isLoading: false });
}

beforeEach(() => {
  mocks.persistFileListCollapsedMock.mockReset();
  mocks.persistTreeDisplayModeMock.mockReset();
  mocks.useTreeDisplaySettingMock.mockClear();
  mocks.shortcutCallbacks.clear();
  mocks.toastInfo.mockReset();
  mocks.patchDiffViewMock.mockClear();
  mocks.useDebouncedSettingMock.mockReset();
  mocks.useGetChangedFilesMock.mockReset();
  mocks.useGetChangedFilesMock.mockReturnValue({ data: [], isLoading: false });
  mocks.useGetFileBlobShasMock.mockReset();
  mocks.useGetFileBlobShasMock.mockReturnValue({ data: [] });
  mocks.useListDiffViewedMock.mockReset();
  mocks.useListDiffViewedMock.mockReturnValue({ data: [] });
  mocks.useDebouncedSettingMock.mockReturnValue({
    value: null,
    setValue: mocks.persistFileListCollapsedMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DiffViewer", () => {
  it("shows loading state", () => {
    mocks.useGetChangedFilesMock.mockReturnValue({ data: [], isLoading: true });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("Loading diff...")).toBeInTheDocument();
    expect(mocks.useTreeDisplaySettingMock).not.toHaveBeenCalled();
  });

  it("keeps hook order stable when the file list resolves", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.useGetChangedFilesMock.mockReturnValue({ data: [], isLoading: true });

    const { rerender } = render(<DiffViewer featureId={1} mode="worktree" />);

    withFooFile();

    expect(() => rerender(<DiffViewer featureId={1} mode="worktree" />)).not.toThrow();
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("React has detected a change in the order of Hooks"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("keeps hook order stable when switching from loaded list back to loading", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    withFooFile();

    const { rerender } = render(<DiffViewer featureId={1} mode="worktree" />);

    mocks.useGetChangedFilesMock.mockReturnValue({ data: [], isLoading: true });

    expect(() => rerender(<DiffViewer featureId={2} mode="worktree" />)).not.toThrow();
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("React has detected a change in the order of Hooks"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("shows 'No changes detected' when the file list is empty", () => {
    mocks.useGetChangedFilesMock.mockReturnValue({ data: [], isLoading: false });
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("No changes detected")).toBeInTheDocument();
    expect(mocks.useTreeDisplaySettingMock).not.toHaveBeenCalled();
  });

  it("retains the changed-files query error instead of rendering an empty state", () => {
    mocks.useGetChangedFilesMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      error: new Error("porcelain failed"),
    });
    render(<DiffViewer featureId={1} mode="worktree" />);

    expect(screen.getByRole("alert")).toHaveTextContent("porcelain failed");
    expect(screen.queryByText("No changes detected")).not.toBeInTheDocument();
  });

  it("renders diff content when files are present", () => {
    withFooFile();
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
  });

  it("does not re-render the diff tree for an identical parent render", () => {
    withFooFile();
    const { rerender } = render(<DiffViewer featureId={1} mode="worktree" />);
    const queryHookCalls = mocks.useGetChangedFilesMock.mock.calls.length;

    rerender(<DiffViewer featureId={1} mode="worktree" />);

    expect(mocks.useGetChangedFilesMock).toHaveBeenCalledTimes(queryHookCalls);
  });

  it("renders the file copy and collapse controls in the file header", () => {
    withFooFile();
    render(<DiffViewer featureId={1} mode="worktree" />);

    const fileHeader = document.querySelector<HTMLElement>("[data-diff-file-header]");
    expect(fileHeader).not.toBeNull();
    expect(
      within(fileHeader as HTMLElement).getByRole("button", { name: /copy path/i }),
    ).toBeInTheDocument();
    expect(
      within(fileHeader as HTMLElement).getByRole("button", { name: /collapse src\/foo.ts/i }),
    ).toBeInTheDocument();
  });

  it("does not render editor-open actions without an editor-open provider", () => {
    withFooFile();
    render(<DiffViewer featureId={1} mode="worktree" />);

    expect(
      screen.queryByRole("button", { name: "Open src/foo.ts in editor" }),
    ).not.toBeInTheDocument();
  });

  it("blocks Mod+O Editor handoff for a both-deleted conflict and explains the resolution", () => {
    mocks.useGetChangedFilesMock.mockReturnValue({
      data: [
        {
          ...fooFile,
          file: "deleted.ts",
          status: "DD",
          stage_state: "conflicted",
          conflict_kind: "dd",
        },
      ],
      isLoading: false,
    });
    const openFileInEditor = vi.fn();
    render(<DiffViewer featureId={1} mode="worktree" onOpenFileInEditor={openFileInEditor} />);
    const shortcutEvent = new KeyboardEvent("keydown", { key: "o", metaKey: true });

    act(() => mocks.shortcutCallbacks.get("diff-next-file")?.(shortcutEvent));
    act(() => mocks.shortcutCallbacks.get("diff-open-focused-file")?.(shortcutEvent));

    expect(openFileInEditor).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledWith("Cannot open deleted.ts in Editor", {
      description: "Both sides deleted this file. Stage the deletion to resolve the conflict.",
    });
  });

  it("renders split/unified toggle buttons", () => {
    withFooFile();
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(screen.getByRole("button", { name: "Split" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
  });

  it("reads the workspace-level git diff view mode setting", () => {
    withFooFile();
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(mocks.useDebouncedSettingMock).toHaveBeenCalledWith("git_diff_view_mode", 0);
  });

  it("persists the diff view mode when toggling Split", async () => {
    const setDiffMode = vi.fn();
    mocks.useDebouncedSettingMock.mockImplementation((key: string) => ({
      value: null,
      setValue: key === "git_diff_view_mode" ? setDiffMode : mocks.persistFileListCollapsedMock,
    }));
    withFooFile();

    const { user } = render(<DiffViewer featureId={1} mode="worktree" />);
    await user.click(screen.getByRole("button", { name: "Split" }));

    expect(setDiffMode).toHaveBeenCalledWith("split");
  });

  it("uses a workspace-level git file list collapse setting", () => {
    withFooFile();
    render(<DiffViewer featureId={1} mode="worktree" />);
    expect(mocks.useDebouncedSettingMock).toHaveBeenCalledWith("git_sidebar_collapsed", 0);
  });

  it("collapses and persists the git file list", async () => {
    withFooFile();
    const { user } = render(<DiffViewer featureId={1} mode="worktree" />);
    await user.click(screen.getByRole("button", { name: "Collapse Git file list" }));

    expect(mocks.persistFileListCollapsedMock).toHaveBeenCalledWith("true");
  });

  it("keeps patch diff instances mounted when toggling the file list", async () => {
    withFooFile();
    const { user } = render(<DiffViewer featureId={1} mode="worktree" />);
    const initialRenderCount = mocks.patchDiffViewMock.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Collapse Git file list" }));

    expect(mocks.patchDiffViewMock.mock.calls.length).toBe(initialRenderCount);
  });

  it("starts with the git file list collapsed when persisted", async () => {
    mocks.useDebouncedSettingMock.mockReturnValue({
      value: "true",
      setValue: mocks.persistFileListCollapsedMock,
    });
    withFooFile();

    render(<DiffViewer featureId={1} mode="worktree" />);

    expect(await screen.findByRole("button", { name: "Expand Git file list" })).toBeInTheDocument();
    // `ResizableSidebarLayout` keeps the sidebar mounted (hidden via
    // CSS + `aria-hidden`) so state inside it survives collapse/expand,
    // so we check the visibility contract instead of DOM presence.
    const filterInput = screen.queryByPlaceholderText("Filter files...");
    expect(filterInput?.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("keeps a collapsed file collapsed when its viewed blob SHA changes", async () => {
    withFooFile();
    mocks.useGetFileBlobShasMock.mockReturnValue({
      data: [{ file_path: "src/foo.ts", sha: "old-sha" }],
    });
    mocks.useListDiffViewedMock.mockReturnValue({
      data: [
        {
          id: 1,
          feature_id: 1,
          file_path: "src/foo.ts",
          blob_sha: "old-sha",
          viewed_at: "now",
        },
      ],
    });

    const { rerender } = render(<DiffViewer featureId={1} mode="worktree" />);
    await vi.waitFor(() => expect(screen.queryByTestId("patch-diff-view")).not.toBeInTheDocument());

    mocks.useGetFileBlobShasMock.mockReturnValue({
      data: [{ file_path: "src/foo.ts", sha: "new-sha" }],
    });
    rerender(<DiffViewer featureId={1} mode="worktree" />);

    await vi.waitFor(() => expect(screen.queryByTestId("patch-diff-view")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Expand src/foo.ts" })).toBeInTheDocument();
  });

  it("does not emit nested button warnings for file headers", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    withFooFile();

    render(<DiffViewer featureId={1} mode="worktree" />);

    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("cannot be a descendant of <button>"),
    );
  });
});

describe("DiffViewer patch rendering", () => {
  it("does not fetch full file contents for normal Git tab rendering", () => {
    mocks.useGetFileContentMock.mockClear();
    withFooFile();

    render(<DiffViewer featureId={1} mode="worktree" />);

    expect(mocks.useGetFileContentMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("patch-diff-view")).toHaveAttribute("data-patch", singleFileDiff);
  });
});
