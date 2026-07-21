import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@/test-utils";
import { useEditorStore } from "@/stores/editor-store";

const mocks = vi.hoisted(() => ({
  changedFiles: { data: undefined as unknown, isError: false, error: null as unknown },
  params: null as unknown,
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

vi.mock("@/api/generated", () => ({
  FileStageState: { conflicted: "conflicted" },
  useGetChangedFiles: (params: unknown) => {
    mocks.params = params;
    return mocks.changedFiles;
  },
}));
vi.mock("@/components/diff/useGitDiffFileTreeModel", () => ({
  resolvedStageState: (file: { stage_state?: string }) => file.stage_state ?? "not_applicable",
}));

import { useAutoConflictResolution } from "./useAutoConflictResolution";

const featureId = 3;

function openTabs(paths: string[]): void {
  const store = useEditorStore.getState();
  store.initFeature(featureId);
  for (const path of paths) store.openFile(featureId, "main", path);
}
function tab(path: string) {
  return useEditorStore
    .getState()
    .features[featureId].panes.main.tabs.find((t) => t.filePath === path);
}

beforeEach(() => {
  useEditorStore.setState({ features: {} });
  mocks.changedFiles.data = undefined;
  mocks.changedFiles.isError = false;
  mocks.changedFiles.error = null;
  mocks.params = null;
  mocks.toastError.mockReset();
});

describe("useAutoConflictResolution", () => {
  it("waits for backend status before touching any tab", () => {
    openTabs(["a.ts"]);
    renderHook(() => useAutoConflictResolution(featureId));
    expect(tab("a.ts")?.resolveConflict ?? false).toBe(false);
    expect(mocks.params).toEqual({ feature_id: featureId, mode: "worktree" });
  });

  it("surfaces conflict-detection failures", () => {
    mocks.changedFiles.isError = true;
    mocks.changedFiles.error = new Error("status failed");

    renderHook(() => useAutoConflictResolution(featureId));

    expect(mocks.toastError).toHaveBeenCalledWith("Could not detect Git conflicts", {
      description: "status failed",
    });
  });

  it("drops only the backend-confirmed unmerged file into the resolver", () => {
    openTabs(["a.ts", "b.ts"]);
    mocks.changedFiles.data = [
      { file: "a.ts", status: "UU", stage_state: "conflicted" },
      { file: "b.ts", status: "M", stage_state: "unstaged" },
    ];
    renderHook(() => useAutoConflictResolution(featureId));
    expect(tab("a.ts")?.resolveConflict).toBe(true);
    expect(tab("b.ts")?.resolveConflict ?? false).toBe(false);
  });

  it("activates when an unusual literal conflicted path is opened after status is known", () => {
    const literalPath = "odd:0|[conflict] -> name\npart.ts";
    mocks.changedFiles.data = [
      { file: literalPath, status: "UU", stage_state: "conflicted" },
      { file: "name.ts", status: "M", stage_state: "unstaged" },
    ];
    const store = useEditorStore.getState();
    store.initFeature(featureId);
    renderHook(() => useAutoConflictResolution(featureId));

    act(() => store.openFile(featureId, "main", literalPath));

    expect(tab(literalPath)?.resolveConflict).toBe(true);
    expect(tab("name.ts")).toBeUndefined();
  });

  it("clears the resolver once the file leaves the unmerged set", () => {
    openTabs(["a.ts"]);
    mocks.changedFiles.data = [{ file: "a.ts", status: "UU", stage_state: "conflicted" }];
    const { rerender } = renderHook(() => useAutoConflictResolution(featureId));
    expect(tab("a.ts")?.resolveConflict).toBe(true);

    mocks.changedFiles.data = [];
    rerender();
    expect(tab("a.ts")?.resolveConflict).toBe(false);
  });
});
