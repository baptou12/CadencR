import type { ReactNode } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils";
import { DiffFileBlock } from "./DiffFileBlock";
import type { FileDiffSection } from "@/lib/parse-unified-diff";

const patch = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1 +1 @@
-old
+new
`;

const defaultSection: FileDiffSection = {
  oldFileName: "src/foo.ts",
  newFileName: "src/foo.ts",
  hunks: [patch],
};

const mocks = vi.hoisted(() => ({
  patchDiffViewMock: vi.fn(
    ({
      patch,
      collapsed,
      renderHeaderPrefix,
      renderHeaderMetadata,
    }: {
      patch: string;
      collapsed?: boolean;
      renderHeaderPrefix?: () => ReactNode;
      renderHeaderMetadata?: () => ReactNode;
    }) => (
      <div
        data-testid="patch-diff-view"
        data-patch={patch}
        data-collapsed={String(Boolean(collapsed))}
      >
        {renderHeaderPrefix?.()}
        {renderHeaderMetadata?.()}
      </div>
    ),
  ),
  // The per-file diff is fetched lazily; tests drive the returned section
  // through this mutable holder instead of passing it as a prop.
  section: null as FileDiffSection | null,
  isLoading: false,
}));

vi.mock("./DiffImageView", () => ({
  DiffImageView: ({ filePath, status }: { filePath: string; status: string }) => (
    <div data-testid="diff-image-view" data-file-path={filePath} data-status={status} />
  ),
}));

vi.mock("./PatchDiffView", () => ({
  PatchDiffView: (props: Parameters<typeof mocks.patchDiffViewMock>[0]) =>
    mocks.patchDiffViewMock(props),
}));

vi.mock("./useFileDiffSection", () => ({
  useFileDiffSection: ({ enabled }: { enabled: boolean }) => ({
    // Models the real hook: a row that hasn't been fetched (collapsed / off
    // screen → `enabled` false) has no section yet.
    section: enabled ? mocks.section : null,
    isLoading: enabled && mocks.isLoading,
    isError: false,
  }),
}));

const baseProps = {
  featureId: 1,
  mode: "uncommitted" as const,
  status: "M",
  isVisible: true,
  diffMode: "unified" as const,
  displayName: "src/foo.ts",
  additions: 1,
  deletions: 1,
  themeAppearance: "dark" as const,
  themeId: "dracula" as const,
  isFocused: false,
  isFileViewed: false,
  showViewedCheckbox: true,
  onToggleFile: vi.fn(),
  onMarkViewedFile: vi.fn(),
  onUnmarkViewedFile: vi.fn(),
};

beforeEach(() => {
  mocks.patchDiffViewMock.mockClear();
  mocks.section = defaultSection;
  mocks.isLoading = false;
});

describe("DiffFileBlock", () => {
  it("renders a cheap header instead of hydrating Pierre for collapsed files", () => {
    const { getByText, queryByTestId } = render(<DiffFileBlock {...baseProps} isCollapsed />);
    expect(getByText("src/foo.ts")).toBeInTheDocument();
    expect(queryByTestId("patch-diff-view")).not.toBeInTheDocument();
  });

  it("shows the file-change status icon in the collapsed header from the status code", () => {
    const { container } = render(<DiffFileBlock {...baseProps} isCollapsed />);
    // status "M" resolves to a "modified" glyph without fetching the patch.
    expect(container.querySelector('use[href="#diffs-icon-symbol-modified"]')).toBeInTheDocument();
  });

  it("renders the lazily-fetched patch hunk once expanded", () => {
    const { getByTestId } = render(<DiffFileBlock {...baseProps} isCollapsed={false} />);
    expect(getByTestId("patch-diff-view")).toHaveAttribute("data-patch", patch);
  });

  it("shows a loader while the per-file diff is still fetching", () => {
    mocks.section = null;
    mocks.isLoading = true;
    const { getByText, queryByTestId } = render(
      <DiffFileBlock {...baseProps} isCollapsed={false} />,
    );
    expect(getByText("Loading diff…")).toBeInTheDocument();
    expect(queryByTestId("patch-diff-view")).not.toBeInTheDocument();
  });

  it("opens the file at the first changed line from the expanded header", async () => {
    const onOpenFileInEditor = vi.fn();
    const { user } = render(
      <DiffFileBlock {...baseProps} isCollapsed={false} onOpenFileInEditor={onOpenFileInEditor} />,
    );

    await user.click(screen.getByRole("button", { name: "Open src/foo.ts in editor" }));

    expect(onOpenFileInEditor).toHaveBeenCalledWith("src/foo.ts", 1);
  });

  it("opens a collapsed file at the top — its patch isn't fetched, so no line", async () => {
    // A collapsed row never fetches its diff, so there's no patch to derive a
    // first-changed line from; it opens at the top (undefined line) rather than
    // paying for a whole-file fetch just to compute a jump target.
    const onOpenFileInEditor = vi.fn();
    const { user } = render(
      <DiffFileBlock {...baseProps} isCollapsed onOpenFileInEditor={onOpenFileInEditor} />,
    );

    await user.click(screen.getByRole("button", { name: "Open src/foo.ts in editor" }));

    expect(onOpenFileInEditor).toHaveBeenCalledWith("src/foo.ts", undefined);
  });

  it("renders an image preview for binary image patches", () => {
    mocks.section = {
      oldFileName: "image.png",
      newFileName: "image.png",
      hunks: [
        `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`,
      ],
    };
    const { getByTestId, queryByText, queryByTestId } = render(
      <DiffFileBlock {...baseProps} displayName="image.png" status="M" isCollapsed={false} />,
    );
    expect(getByTestId("diff-image-view")).toHaveAttribute("data-file-path", "image.png");
    expect(queryByText("Binary file")).not.toBeInTheDocument();
    expect(queryByTestId("patch-diff-view")).not.toBeInTheDocument();
  });

  it("keeps the binary placeholder for non-image binary files", () => {
    mocks.section = {
      oldFileName: "archive.zip",
      newFileName: "archive.zip",
      hunks: [
        `diff --git a/archive.zip b/archive.zip
Binary files a/archive.zip and b/archive.zip differ
`,
      ],
    };
    const { getByText, queryByTestId } = render(
      <DiffFileBlock {...baseProps} displayName="archive.zip" status="M" isCollapsed={false} />,
    );
    expect(getByText("Binary file")).toBeInTheDocument();
    expect(queryByTestId("diff-image-view")).not.toBeInTheDocument();
  });

  it("gates a large text diff behind an opt-in instead of freezing on expand", async () => {
    // A patch with more changed lines than LARGE_DIFF_LINES (1500): rendering
    // it synchronously through Pierre would jank, so we show a placeholder.
    const bigHunkBody = Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join("\n");
    const bigPatch = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -0,0 +1,2000 @@
${bigHunkBody}
`;
    mocks.section = { oldFileName: "big.ts", newFileName: "big.ts", hunks: [bigPatch] };
    const { getByText, queryByTestId, getByRole, user } = render(
      <DiffFileBlock
        {...baseProps}
        displayName="big.ts"
        additions={2000}
        deletions={0}
        isCollapsed={false}
      />,
    );
    // Placeholder shown, Pierre NOT hydrated (no synchronous parse/render).
    expect(getByText("Large file")).toBeInTheDocument();
    expect(queryByTestId("patch-diff-view")).not.toBeInTheDocument();

    // Explicit opt-in renders the real diff — progressively, in bounded
    // chunks (2000 lines → 400-line sub-patches), never as one giant instance.
    await user.click(getByRole("button", { name: "Display diff" }));
    const chunks = screen.getAllByTestId("patch-diff-view");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].getAttribute("data-patch")).toContain("diff --git a/big.ts b/big.ts");
    expect(chunks[0].getAttribute("data-patch")?.length).toBeLessThan(bigPatch.length);
  });
});
