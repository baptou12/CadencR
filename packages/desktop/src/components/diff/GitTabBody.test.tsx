import { render } from "@/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { PrReviewThreads } from "@/hooks/usePrReviewThreads";
import type { PrThreadLine, ReviewNavigationTarget } from "@/lib/pr-review-threads";
import { GitTabBody, type GitTabBodyProps } from "./GitTabBody";

const mocks = vi.hoisted(() => ({
  diffViewer: vi.fn(),
}));

vi.mock("./DiffViewer", () => ({
  DiffViewer: (props: unknown) => {
    mocks.diffViewer(props);
    return <div>Diff viewer</div>;
  },
}));
vi.mock("@/components/FeaturePrView", () => ({ FeaturePrView: () => null }));
vi.mock("./GitBranchesView", () => ({ GitBranchesView: () => null }));
vi.mock("./GitGraphView", () => ({ GitGraphView: () => null }));
vi.mock("./StashesView", () => ({ StashesView: () => null }));

const REVIEW_THREADS: PrReviewThreads = {
  threads: [],
  unresolved: [],
  unresolvedCount: 0,
  unresolvedLinesByFile: new Map(),
  navigationTargets: [],
  summary: {
    total: 0,
    anchored: 0,
    general: 0,
    outdated: 0,
    automated: 0,
    byFile: new Map(),
  },
  isLoading: false,
  isRefreshing: false,
  errorMessage: undefined,
  retry: () => undefined,
};

describe("GitTabBody review scope", () => {
  it("passes review state only to the proposal diff", () => {
    const remoteThreadLinesByFile = new Map<string, PrThreadLine[]>();
    const reviewCountsByFile = new Map([["src/app.ts", 1]]);
    const reviewTarget: ReviewNavigationTarget = {
      threadId: "thread-1",
      filePath: "src/app.ts",
      lineNumber: 12,
      side: "new",
    };
    const selectedReviewThreadIds = new Set(["thread-1"]);
    const onReviewThreadSelectedChange = vi.fn();
    const props: GitTabBodyProps = {
      viewMode: "uncommitted",
      featureId: 4,
      projectId: 6,
      diffMode: "uncommitted",
      diffTargetBranch: undefined,
      fileListCollapsed: false,
      onFileListCollapsedChange: vi.fn(),
      onRequestUncommitted: vi.fn(),
      recoveryRegion: null,
      reviewThreads: REVIEW_THREADS,
      remoteThreadLinesByFile,
      reviewCountsByFile,
      reviewTarget,
      selectedReviewThreadIds,
      onReviewThreadSelectedChange,
      onViewReviewThread: vi.fn(),
    };
    const { rerender } = render(<GitTabBody {...props} />);

    expect(mocks.diffViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        remoteThreadLinesByFile: undefined,
        reviewCountsByFile: undefined,
        reviewTarget: null,
        selectedReviewThreadIds: undefined,
        onReviewThreadSelectedChange: undefined,
      }),
    );

    rerender(<GitTabBody {...props} viewMode="vs-target" diffMode="branch" />);
    expect(mocks.diffViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        remoteThreadLinesByFile,
        reviewCountsByFile,
        reviewTarget,
        selectedReviewThreadIds,
        onReviewThreadSelectedChange,
      }),
    );
  });
});
