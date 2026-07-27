import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { GitTabToolbar, type GitTabToolbarProps } from "./GitTabToolbar";

function renderToolbar(overrides: Partial<GitTabToolbarProps> = {}) {
  return render(
    <GitTabToolbar
      viewMode="uncommitted"
      onViewModeChange={vi.fn()}
      targetBranch="main"
      prLabel={undefined}
      prNumber={undefined}
      prTone="neutral"
      prAttention={false}
      uncommittedCount={3}
      conflictCount={0}
      pendingViewMode={null}
      isListView={false}
      fileListCollapsed={false}
      isFileListCollapseLoading={false}
      onToggleFileList={vi.fn()}
      stats={{ isLoading: false, isError: false, additions: 12, deletions: 4 }}
      {...overrides}
    />,
  );
}

describe("GitTabToolbar", () => {
  it("puts the file-list toggle before the tabs and the numstat last", () => {
    renderToolbar();

    const toggle = screen.getByRole("button", { name: "Hide file list" });
    const firstTab = screen.getByRole("tab", { name: /Changes/ });
    const stats = screen.getByText("+12");

    expect(toggle.compareDocumentPosition(firstTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(firstTab.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("keeps the toggle's slot in list views so the tab strip does not shift", () => {
    const { container } = renderToolbar({ isListView: true, viewMode: "branches" });

    expect(screen.queryByRole("button", { name: /file list/i })).not.toBeInTheDocument();
    expect(screen.queryByText("+12")).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="file-list-toggle-placeholder"]'),
    ).toBeInTheDocument();
  });
});
