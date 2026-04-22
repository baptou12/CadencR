import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@/test-utils";
import { DiffFileBlock } from "./DiffFileBlock";

const mocks = vi.hoisted(() => ({
  useGetFileContentMock: vi.fn(
    (): { data: { old_content: string; new_content: string } | undefined } => ({ data: undefined }),
  ),
}));

vi.mock("@/api/generated", () => ({
  useGetFileContent: mocks.useGetFileContentMock,
}));

vi.mock("@/components/editor/ReadOnlyDiffView", () => ({
  ReadOnlyDiffView: () => <div data-testid="diff-view" />,
}));

beforeEach(() => {
  mocks.useGetFileContentMock.mockReset();
  mocks.useGetFileContentMock.mockReturnValue({ data: undefined });
});

describe("DiffFileBlock", () => {
  it("does not render a lazy-load spacer for collapsed files", () => {
    const { container } = render(
      <DiffFileBlock
        section={{ oldFileName: "src/foo.ts", newFileName: "src/foo.ts", hunks: ["@@ -1 +1 @@"] }}
        featureId={1}
        mode="worktree"
        diffMode="unified"
        displayName="src/foo.ts"
        isCollapsed
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders immediately for a manually expanded file", () => {
    mocks.useGetFileContentMock.mockReturnValue({
      data: { old_content: "old line", new_content: "new line" },
    });

    const { getByTestId } = render(
      <DiffFileBlock
        section={{ oldFileName: "src/foo.ts", newFileName: "src/foo.ts", hunks: ["@@ -1 +1 @@"] }}
        featureId={1}
        mode="worktree"
        diffMode="unified"
        displayName="src/foo.ts"
        isCollapsed={false}
        forceRender
      />,
    );

    expect(getByTestId("diff-view")).toBeInTheDocument();
  });
});
