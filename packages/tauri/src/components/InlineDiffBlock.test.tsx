import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { InlineDiffBlock } from "./InlineDiffBlock";

// Mock @git-diff-view/react to avoid canvas/DOM issues in jsdom
vi.mock("@git-diff-view/react", () => ({
  DiffFile: {
    createInstance: vi.fn(() => ({
      initTheme: vi.fn(),
      initRaw: vi.fn(),
      initSyntax: vi.fn(),
      buildSplitDiffLines: vi.fn(),
      buildUnifiedDiffLines: vi.fn(),
      additionLength: 1,
      deletionLength: 1,
    })),
  },
  DiffView: vi.fn(({ diffFile }: { diffFile: unknown }) => (
    diffFile ? <div data-testid="diff-view">diff content</div> : null
  )),
  DiffModeEnum: { Unified: "unified" },
  highlighter: {},
}));

vi.mock("@git-diff-view/lowlight", () => ({
  highlighter: {},
}));

describe("InlineDiffBlock", () => {
  it("shows 'No changes' when content is identical", () => {
    render(
      <InlineDiffBlock
        filePath="src/foo.ts"
        oldContent="const x = 1;"
        newContent="const x = 1;"
      />
    );
    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("renders file path when content differs", () => {
    render(
      <InlineDiffBlock
        filePath="src/example.ts"
        oldContent="const x = 1;"
        newContent="const x = 2;"
      />
    );
    expect(screen.getByText("src/example.ts")).toBeInTheDocument();
  });

  it("shows diff view when content differs", () => {
    render(
      <InlineDiffBlock
        filePath="test.ts"
        oldContent={"line1\nline2\n"}
        newContent={"line1\nline3\n"}
      />
    );
    expect(screen.getByTestId("diff-view")).toBeInTheDocument();
  });
});
