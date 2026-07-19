import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import type { FileTreeDirectoryHandle } from "@pierre/trees";
import { describe, expect, it, vi } from "vitest";
import { FileStageState, type ChangedFile } from "@/api/generated";
import { CadencrFileTree } from "@/components/file-tree/CadencrFileTree";
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

  it("moves through Pierre's filename presentation order instead of API order", () => {
    const files = [changedFile("a/zeta.ts"), changedFile("z/alpha.ts")];
    const { result, unmount } = renderHook(() =>
      useGitDiffFileTreeModel({
        files,
        viewedFiles: new Set(),
        indexActions,
        onSelectionChange: vi.fn(),
      }),
    );

    act(() => result.current.setDisplayMode("filenames"));
    act(() => result.current.navigation.selectPath("z/alpha.ts"));

    let movedPath: string | null = null;
    act(() => {
      movedPath = result.current.navigation.moveSelection(1);
    });

    expect(movedPath).toBe("a/zeta.ts");
    expect(result.current.model.getFocusedPath()).toBe("zeta.ts");
    expect(result.current.activePath).toBe("a/zeta.ts");

    act(() => {
      movedPath = result.current.navigation.moveSelection(-1);
    });
    expect(movedPath).toBe("z/alpha.ts");
    expect(result.current.model.getFocusedPath()).toBe("alpha.ts");
    expect(result.current.activePath).toBe("z/alpha.ts");
    unmount();
  });

  it("skips hidden nonmatches after a retained Pierre search loses focus", () => {
    const files = [
      changedFile("src/alpha-match.ts"),
      changedFile("src/beta-hidden.ts"),
      changedFile("src/zeta-match.ts"),
    ];
    const { result, unmount } = renderHook(() =>
      useGitDiffFileTreeModel({
        files,
        viewedFiles: new Set(),
        indexActions,
        onSelectionChange: vi.fn(),
      }),
    );

    act(() => result.current.model.setSearch("match"));
    const tree = render(<CadencrFileTree model={result.current.model} />);
    const searchInput = result.current.model
      .getFileTreeContainer()
      ?.shadowRoot?.querySelector<HTMLInputElement>("[data-file-tree-search-input]");
    expect(searchInput).not.toBeNull();
    fireEvent.blur(searchInput as HTMLInputElement);
    expect(result.current.model.getSearchValue()).toBe("match");

    act(() => result.current.navigation.selectPath("src/alpha-match.ts"));
    let movedPath: string | null = null;
    act(() => {
      movedPath = result.current.navigation.moveSelection(1);
    });

    expect(movedPath).toBe("src/zeta-match.ts");
    expect(result.current.model.getFocusedPath()).toBe("src/zeta-match.ts");
    expect(result.current.activePath).toBe("src/zeta-match.ts");
    tree.unmount();
    unmount();
  });

  it("renders no rows and does not move selection after a retained zero-result search", async () => {
    const files = [changedFile("src/alpha.ts"), changedFile("src/beta.ts")];
    const { result, unmount } = renderHook(() =>
      useGitDiffFileTreeModel({
        files,
        viewedFiles: new Set(),
        indexActions,
        onSelectionChange: vi.fn(),
      }),
    );

    act(() => {
      result.current.navigation.selectPath("src/alpha.ts");
      result.current.model.setSearch("alpha");
    });
    const tree = render(<CadencrFileTree model={result.current.model} />);
    const shadowRoot = result.current.model.getFileTreeContainer()?.shadowRoot;
    const searchInput = shadowRoot?.querySelector<HTMLInputElement>(
      "[data-file-tree-search-input]",
    );
    expect(searchInput).not.toBeNull();
    expect(shadowRoot?.querySelector('[data-item-path="src/alpha.ts"]')).not.toBeNull();

    act(() => result.current.model.setSearch("no-results"));
    fireEvent.blur(searchInput as HTMLInputElement);
    expect(result.current.model.getSearchValue()).toBe("no-results");
    await waitFor(() => expect(shadowRoot?.querySelectorAll("[data-item-path]")).toHaveLength(0));

    const selectedBeforeMove = result.current.model.getSelectedPaths();
    const focusedBeforeMove = result.current.model.getFocusedPath();
    let movedPath: string | null = "unexpected";
    act(() => {
      movedPath = result.current.navigation.moveSelection(1);
    });

    expect(movedPath).toBeNull();
    expect(result.current.model.getSelectedPaths()).toEqual(selectedBeforeMove);
    expect(result.current.model.getFocusedPath()).toBe(focusedBeforeMove);
    tree.unmount();
    unmount();
  });

  it("skips files hidden by collapsed directories in Pierre tree order", () => {
    const files = [changedFile("a/alpha.ts"), changedFile("b/beta.ts"), changedFile("root.ts")];
    const { result, unmount } = renderHook(() =>
      useGitDiffFileTreeModel({
        files,
        viewedFiles: new Set(),
        indexActions,
        onSelectionChange: vi.fn(),
      }),
    );

    act(() => {
      (result.current.model.getItem("b/") as FileTreeDirectoryHandle).collapse();
      result.current.navigation.selectPath("a/alpha.ts");
    });

    let movedPath: string | null = null;
    act(() => {
      movedPath = result.current.navigation.moveSelection(1);
    });

    expect(movedPath).toBe("root.ts");
    expect(result.current.model.getFocusedPath()).toBe("root.ts");
    expect(result.current.activePath).toBe("root.ts");
    unmount();
  });
});
