import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type { GitFileIndexActions } from "./useGitFileIndexActions";

vi.mock("@/api/generated", () => ({
  ConflictKind: { dd: "dd", au: "au", ud: "ud", ua: "ua", du: "du", aa: "aa", uu: "uu" },
  FileStageState: { conflicted: "conflicted" },
}));

import { GitConflictFileBanner } from "./GitConflictFileBanner";

const file = {
  file: "src/conflict.ts",
  status: "UU",
  additions: 2,
  deletions: 2,
  stage_state: "conflicted" as const,
  conflict_kind: "uu" as const,
};

function actions(overrides: Partial<GitFileIndexActions> = {}): GitFileIndexActions {
  return {
    stage: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    pendingAction: null,
    pendingPath: null,
    error: null,
    ...overrides,
  };
}

describe("GitConflictFileBanner", () => {
  it("offers Fix to open the editor instead of Stage for content conflicts", async () => {
    const indexActions = actions();
    const onOpenFileInEditor = vi.fn();
    const { user } = render(
      <GitConflictFileBanner
        file={file}
        indexActions={indexActions}
        onOpenFileInEditor={onOpenFileInEditor}
      />,
    );

    expect(screen.getByText(/^both modified$/i)).toBeInTheDocument();
    expect(screen.getByText(/open it to resolve the markers/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stage" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fix" }));
    expect(onOpenFileInEditor).toHaveBeenCalledOnce();
    expect(indexActions.stage).not.toHaveBeenCalled();
  });

  it("labels a both-deleted conflict as an explicit deletion", async () => {
    const indexActions = actions();
    const { user } = render(
      <GitConflictFileBanner
        file={{ ...file, status: "DD", conflict_kind: "dd" }}
        indexActions={indexActions}
        onOpenFileInEditor={vi.fn()}
      />,
    );
    expect(screen.getByText(/both sides deleted/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stage deletion" }));
    expect(indexActions.stage).toHaveBeenCalledWith(file.file, { conflicted: true });
  });

  it("shows visible stage-pending and stage-error states for deletions", () => {
    render(
      <GitConflictFileBanner
        file={{ ...file, status: "DD", conflict_kind: "dd" }}
        indexActions={actions({
          isPending: true,
          pendingAction: "stage",
          pendingPath: file.file,
          error: { action: "stage", filePath: file.file, message: "index locked" },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Staging…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("index locked");
  });
});
