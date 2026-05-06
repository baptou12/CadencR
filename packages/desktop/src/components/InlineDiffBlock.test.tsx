import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { InlineDiffBlock } from "./InlineDiffBlock";

// Mock CodeMirror-based ReadOnlyDiffView to avoid DOM issues in jsdom
vi.mock("@/components/editor/ReadOnlyDiffView", () => ({
  ReadOnlyDiffView: ({ oldContent, newContent }: { oldContent: string; newContent: string }) =>
    oldContent !== newContent ? <div data-testid="diff-view">diff content</div> : null,
}));

describe("InlineDiffBlock", () => {
  it("shows 'No changes' when content is identical", () => {
    render(
      <InlineDiffBlock filePath="src/foo.ts" oldContent="const x = 1;" newContent="const x = 1;" />,
    );
    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("renders file path when content differs", () => {
    render(
      <InlineDiffBlock
        filePath="src/example.ts"
        oldContent="const x = 1;"
        newContent="const x = 2;"
      />,
    );
    expect(screen.getByText("src/example.ts")).toBeInTheDocument();
  });

  it("shows diff view when content differs", () => {
    render(
      <InlineDiffBlock
        filePath="test.ts"
        oldContent={"line1\nline2\n"}
        newContent={"line1\nline3\n"}
      />,
    );
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
  });

  it("displays addition and deletion counts", () => {
    render(
      <InlineDiffBlock filePath="test.ts" oldContent={"a\nb\nc\n"} newContent={"a\nx\ny\nc\n"} />,
    );
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("strips basePath from displayed file path", () => {
    render(
      <InlineDiffBlock
        filePath="/home/user/project/src/foo.ts"
        oldContent="old"
        newContent="new"
        basePath="/home/user/project"
      />,
    );
    expect(screen.getByText("src/foo.ts")).toBeInTheDocument();
  });
});
