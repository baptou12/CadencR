import { act, renderHook } from "@testing-library/react";
import type { FileTreeDirectoryHandle } from "@pierre/trees";
import { describe, expect, it, vi } from "vitest";
import { FileStageState, type ChangedFile } from "@/api/generated";
import type { GitFileIndexActions } from "./useGitFileIndexActions";

vi.mock("@/hooks/useFileTreeIconSet", () => ({
  useFileTreeIconSet: () => ({ iconSet: "standard", setIconSet: vi.fn(), isLoading: false }),
}));

vi.mock("./useGitDiffTreeDisplaySetting", async () => {
  const React = await import("react");
  return {
    useGitDiffTreeDisplaySetting: () => {
      const [displayMode, setDisplayMode] = React.useState<"tree" | "filenames">("tree");
      return React.useMemo(
        () => ({ displayMode, setDisplayMode, isPending: false }),
        [displayMode],
      );
    },
  };
});

import { useGitDiffFileTreeModel } from "./useGitDiffFileTreeModel";

const indexActions: GitFileIndexActions = {
  stage: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  pendingAction: null,
  pendingPath: null,
  error: null,
};

function changedFile(file: string): ChangedFile {
  return {
    file,
    status: "M",
    additions: 1,
    deletions: 0,
    stage_state: FileStageState.unstaged,
  };
}

describe("useGitDiffFileTreeModel display mode", () => {
  it("preserves exact selection and deliberate directory collapse across modes", () => {
    const files = [changedFile("src/nested/a.ts"), changedFile("tests/a.ts")];
    const { result, rerender, unmount } = renderHook(
      ({ currentFiles }: { currentFiles: readonly ChangedFile[] }) =>
        useGitDiffFileTreeModel({
          files: currentFiles,
          viewedFiles: new Set(),
          indexActions,
          onSelectionChange: vi.fn(),
        }),
      { initialProps: { currentFiles: files } },
    );

    act(() => {
      result.current.navigation.selectPath("src/nested/a.ts");
      const directory = result.current.model.getItem("src/") as FileTreeDirectoryHandle;
      directory.collapse();
    });
    expect((result.current.model.getItem("src/") as FileTreeDirectoryHandle).isExpanded()).toBe(
      false,
    );

    act(() => result.current.setDisplayMode("filenames"));
    const flatFocusedPath = result.current.model.getFocusedPath();
    expect(result.current.displayMode).toBe("filenames");
    expect(flatFocusedPath).not.toContain("/");
    expect(result.current.resolveFilePath(flatFocusedPath ?? "")).toBe("src/nested/a.ts");
    expect(result.current.activePath).toBe("src/nested/a.ts");
    expect(result.current.model.getItem("src/")).toBeNull();

    rerender({ currentFiles: [...files, changedFile("new/fresh.ts")] });

    act(() => result.current.setDisplayMode("tree"));
    const restoredDirectory = result.current.model.getItem("src/") as FileTreeDirectoryHandle;
    const newDirectory = result.current.model.getItem("new/") as FileTreeDirectoryHandle;
    expect(result.current.activePath).toBe("src/nested/a.ts");
    expect(result.current.model.getFocusedPath()).toBe("src/nested/a.ts");
    expect(restoredDirectory.isExpanded()).toBe(false);
    expect(newDirectory.isExpanded()).toBe(true);

    unmount();
  });
});
