import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { render } from "@/test-utils";
import { DiffFileBlock } from "./DiffFileBlock";

interface MockFileContent {
  old_content: string | null;
  new_content: string | null;
  old_size: number;
  new_size: number;
  is_binary: boolean;
  is_large: boolean;
}

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useGetFileContentMock: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  useGetFileContent: mocks.useGetFileContentMock,
}));

vi.mock("@/components/editor/ReadOnlyDiffView", () => ({
  ReadOnlyDiffView: () => <div data-testid="diff-view" />,
}));

function mockContent(data: MockFileContent | undefined, isFetching = false): void {
  mocks.useGetFileContentMock.mockReturnValue({
    data,
    refetch: mocks.refetch,
    isFetching,
  });
}

const baseProps = {
  section: { oldFileName: "src/foo.ts", newFileName: "src/foo.ts", hunks: ["@@ -1 +1 @@"] },
  featureId: 1,
  mode: "worktree" as const,
  diffMode: "unified" as const,
  displayName: "src/foo.ts",
  additions: 1,
  deletions: 0,
};

const smallText: MockFileContent = {
  old_content: "old line",
  new_content: "new line",
  old_size: 8,
  new_size: 8,
  is_binary: false,
  is_large: false,
};

const largeFile: MockFileContent = {
  old_content: null,
  new_content: null,
  old_size: 0,
  new_size: 1_500_000,
  is_binary: false,
  is_large: true,
};

const binaryFile: MockFileContent = {
  old_content: null,
  new_content: null,
  old_size: 0,
  new_size: 4096,
  is_binary: true,
  is_large: false,
};

beforeEach(() => {
  mocks.useGetFileContentMock.mockReset();
  mocks.refetch.mockReset();
  mockContent(undefined);
});

describe("DiffFileBlock", () => {
  it("does not render a lazy-load spacer for collapsed files", () => {
    const { container } = render(<DiffFileBlock {...baseProps} isCollapsed />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the diff view immediately for a manually expanded small file", () => {
    mockContent(smallText);
    const { getByTestId } = render(
      <DiffFileBlock {...baseProps} isCollapsed={false} forceRender />,
    );
    expect(getByTestId("diff-view")).toBeInTheDocument();
  });

  it("renders a 'Display diff' placeholder for large files instead of CodeMirror", () => {
    mockContent(largeFile);
    const { getByText, queryByTestId } = render(
      <DiffFileBlock {...baseProps} isCollapsed={false} forceRender />,
    );
    expect(getByText("Large file")).toBeInTheDocument();
    expect(getByText("Display diff")).toBeInTheDocument();
    expect(queryByTestId("diff-view")).not.toBeInTheDocument();
  });

  it("renders a binary placeholder without a 'Display diff' button", () => {
    mockContent(binaryFile);
    const { getByText, queryByText, queryByTestId } = render(
      <DiffFileBlock {...baseProps} isCollapsed={false} forceRender />,
    );
    expect(getByText("Binary file")).toBeInTheDocument();
    expect(queryByText("Display diff")).not.toBeInTheDocument();
    expect(queryByTestId("diff-view")).not.toBeInTheDocument();
  });

  it("opting in on a line-count-large file with cached content does not refetch", async () => {
    // Batch already returned content (file is small bytewise) but the unified
    // diff has 6k changed lines, so the line-count gate flips isLarge=true.
    mockContent({ ...smallText, is_large: false });
    const { getByText, findByTestId } = render(
      <DiffFileBlock
        {...baseProps}
        isCollapsed={false}
        forceRender
        additions={6_000}
        deletions={0}
      />,
    );
    fireEvent.click(getByText("Display diff"));
    expect(mocks.refetch).not.toHaveBeenCalled();
    expect(await findByTestId("diff-view")).toBeInTheDocument();
  });

  it("opting in on a large file shows a loader, then refetches and renders the diff", async () => {
    mockContent(largeFile);
    const { getByText, rerender, findByTestId, findByText } = render(
      <DiffFileBlock {...baseProps} isCollapsed={false} forceRender />,
    );
    fireEvent.click(getByText("Display diff"));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    // Spinner appears immediately, before the (synchronous) editor mounts.
    expect(await findByText("Computing diff…")).toBeInTheDocument();

    // Simulate the refetch returning full content.
    mockContent({ ...largeFile, old_content: "x", new_content: "y", is_large: true });
    rerender(<DiffFileBlock {...baseProps} isCollapsed={false} forceRender />);
    // The double-RAF defer flips opt-in to "yes" on the next frame.
    expect(await findByTestId("diff-view")).toBeInTheDocument();
  });
});
