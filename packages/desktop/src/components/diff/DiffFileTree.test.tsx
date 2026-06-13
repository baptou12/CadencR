import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { DiffFileTree, type ChangedFileEntry } from "./DiffFileTree";

const mockFiles: ChangedFileEntry[] = [
  { file: "src/foo.ts", status: "M", additions: 5, deletions: 2 },
  { file: "src/bar.ts", status: "A", additions: 10, deletions: 0 },
  { file: "src/nested/deep.ts", status: "D", additions: 0, deletions: 3 },
];

describe("DiffFileTree", () => {
  it("renders files in the tree", () => {
    render(
      <DiffFileTree
        files={mockFiles}
        expandedFiles={new Set(["src/foo.ts"])}
        selectedFile={null}
        onToggleExpand={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );
    expect(screen.getByText("foo.ts")).toBeInTheDocument();
    expect(screen.getByText("bar.ts")).toBeInTheDocument();
    expect(screen.getByText("deep.ts")).toBeInTheDocument();
  });

  it("shows empty message when no files", () => {
    render(
      <DiffFileTree
        files={[]}
        expandedFiles={new Set()}
        selectedFile={null}
        onToggleExpand={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );
    expect(screen.getByText("No changed files")).toBeInTheDocument();
  });

  it("highlights selected file", () => {
    render(
      <DiffFileTree
        files={mockFiles}
        expandedFiles={new Set()}
        selectedFile="src/foo.ts"
        onToggleExpand={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );
    // Selected file row has bg-accent class
    const fooBtn = screen.getByTitle("src/foo.ts");
    expect(fooBtn.closest("div")).toHaveClass("bg-accent");
  });

  it("calls onSelectFile when file name is clicked", () => {
    const onSelectFile = vi.fn();
    render(
      <DiffFileTree
        files={mockFiles}
        expandedFiles={new Set()}
        selectedFile={null}
        onToggleExpand={vi.fn()}
        onSelectFile={onSelectFile}
      />,
    );
    fireEvent.click(screen.getByTitle("src/foo.ts"));
    expect(onSelectFile).toHaveBeenCalledWith("src/foo.ts");
  });

  it("calls onToggleExpand when expand button is clicked", () => {
    const onToggleExpand = vi.fn();
    render(
      <DiffFileTree
        files={[{ file: "src/foo.ts", status: "M", additions: 1, deletions: 0 }]}
        expandedFiles={new Set()}
        selectedFile={null}
        onToggleExpand={onToggleExpand}
        onSelectFile={vi.fn()}
      />,
    );
    // The expand/collapse button (Plus/Minus) is before the file name button
    const expandBtn = screen.getByTitle("Expand diff");
    fireEvent.click(expandBtn);
    expect(onToggleExpand).toHaveBeenCalledWith("src/foo.ts");
  });

  it("filters files by search input", () => {
    render(
      <DiffFileTree
        files={mockFiles}
        expandedFiles={new Set()}
        selectedFile={null}
        onToggleExpand={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText("Filter files...");
    fireEvent.change(input, { target: { value: "foo" } });
    expect(screen.getByText("foo.ts")).toBeInTheDocument();
    expect(screen.queryByText("bar.ts")).not.toBeInTheDocument();
  });

  it("renders the staged badge only for is_staged files", () => {
    const files: ChangedFileEntry[] = [
      { file: "staged.ts", status: "M", additions: 1, deletions: 0, is_staged: true },
      { file: "unstaged.ts", status: "M", additions: 1, deletions: 0 },
    ];
    render(
      <DiffFileTree
        files={files}
        expandedFiles={new Set()}
        selectedFile={null}
        onToggleExpand={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );
    // Only one staged badge should render — on the staged file's row.
    expect(screen.getAllByTestId("staged-badge")).toHaveLength(1);
  });

  it("renders directory structure for nested paths", () => {
    render(
      <DiffFileTree
        files={mockFiles}
        expandedFiles={new Set()}
        selectedFile={null}
        onToggleExpand={vi.fn()}
        onSelectFile={vi.fn()}
      />,
    );
    expect(screen.getByText("src")).toBeInTheDocument();
  });
});
