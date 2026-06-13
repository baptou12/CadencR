import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { GitGraphRow, type GitGraphRowData } from "./GitGraphRow";
import type { GraphRow } from "@/lib/git-graph-layout";

const row: GraphRow = {
  commitCol: 0,
  lanesBefore: [null],
  lanesAfter: ["parent"],
  mergeInCols: [],
  parentCols: [0],
};

const commit: GitGraphRowData = {
  sha: "abc123def",
  shortSha: "abc123d",
  message: "Fix the thing",
  body: "",
  author: "rle",
  date: "2026-01-01 12:00:00 +0000",
  isPushed: true,
  parents: ["parent"],
  refs: ["feature/x", "origin/main"],
  filesChanged: 3,
  additions: 10,
  deletions: 2,
};

describe("GitGraphRow", () => {
  it("renders the message, ref pills and file count", () => {
    render(
      <GitGraphRow
        commit={commit}
        row={row}
        columns={1}
        onOpenCommit={vi.fn()}
        onOpenOnline={vi.fn()}
      />,
    );
    expect(screen.getByText("Fix the thing")).toBeInTheDocument();
    expect(screen.getByText("feature/x")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("3 files")).toBeInTheDocument();
  });

  it("opens the commit diff on click", () => {
    const onOpenCommit = vi.fn();
    render(
      <GitGraphRow
        commit={commit}
        row={row}
        columns={1}
        onOpenCommit={onOpenCommit}
        onOpenOnline={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenCommit).toHaveBeenCalledWith("abc123def");
  });
});
