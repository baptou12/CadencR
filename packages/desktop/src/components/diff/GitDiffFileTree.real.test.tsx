import { FileTree } from "@pierre/trees";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { FileStageState, type ChangedFile } from "@/api/generated";
import type { GitFileIndexActions } from "./useGitFileIndexActions";
import { GitDiffFileTree } from "./GitDiffFileTree";

const file: ChangedFile = {
  file: "src/file.ts",
  status: "M",
  additions: 1,
  deletions: 0,
  stage_state: FileStageState.unstaged,
};

const indexActions: GitFileIndexActions = {
  stage: vi.fn(),
  reset: vi.fn(),
  isPending: false,
  pendingAction: null,
  pendingPath: null,
  error: null,
};

describe("GitDiffFileTree with the real CadencrFileTree wrapper", () => {
  it("does not overlay the empty placeholder on a populated Pierre tree", () => {
    const model = new FileTree({ paths: ["src/", "src/file.ts"] });
    const { unmount } = render(
      <GitDiffFileTree
        model={model}
        files={[file]}
        expandedFiles={new Set([file.file])}
        indexActions={indexActions}
        displayMode="tree"
        isDisplayModePending={false}
        onDisplayModeChange={vi.fn()}
        resolveFilePath={(treePath) => treePath}
        onToggleExpand={vi.fn()}
      />,
    );

    expect(screen.getByText("1 changed file")).toBeInTheDocument();
    expect(screen.queryByText("No changed files")).not.toBeInTheDocument();
    expect(model.getItem(file.file)).not.toBeNull();
    unmount();
    model.cleanUp();
  });
});
