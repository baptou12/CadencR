import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { FeatureGitTab } from "./FeatureGitTab";
import { useGitStatusStore } from "@/stores/useGitStatusStore";
import type { StashConflictOutcome } from "./diff/stash-contracts";

const mocks = vi.hoisted(() => ({
  setFeatureSetting: vi.fn(),
  persistSidebar: vi.fn(),
}));

vi.mock("@/api/generated", () => ({
  getGetFeatureSettingsQueryKey: (featureId: number) => ["/api/features/settings", featureId],
  useGetFeatureSettings: () => ({ data: [{ key: "git_view_mode", value: "stashes" }] }),
  useGetStats: () => ({ isLoading: false, isError: false, data: undefined }),
  useListDiffComments: () => ({ data: [] }),
  useSetFeatureSetting: () => ({ mutate: mocks.setFeatureSetting }),
}));

vi.mock("@/hooks/useShortcut", () => ({ useScopedGlobalShortcutById: vi.fn() }));
vi.mock("@/hooks/useDebouncedSetting", () => ({
  useDebouncedSetting: () => ({
    value: "false",
    setValue: mocks.persistSidebar,
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useSendPendingComments", () => ({
  useSendPendingComments: () => ({
    send: vi.fn(),
    sending: false,
    buttonLabel: "Send",
    disabled: true,
    shouldRender: false,
  }),
}));
vi.mock("./git-actions/GitUpdateRecoveryBanner", () => ({
  GitUpdateRecoveryRegion: () => null,
}));
vi.mock("./diff/StashesView", () => ({
  StashesView: ({ onConflicts }: { onConflicts?: (outcome: StashConflictOutcome) => void }) => (
    <button
      type="button"
      onClick={() =>
        onConflicts?.({
          operation: "pop",
          stash: {
            ref_name: "stash@{0}",
            sha: "a".repeat(40),
            message: "WIP",
            date: "2026-01-01 12:00:00 +0000",
            files_changed: 1,
            additions: 1,
            deletions: 0,
          },
          conflictFiles: ["src/conflict.ts"],
        })
      }
    >
      Report stash conflict
    </button>
  ),
}));
vi.mock("./diff/DiffViewer", () => ({ DiffViewer: () => null }));
vi.mock("./diff/GitGraphView", () => ({ GitGraphView: () => null }));
vi.mock("./diff/GitBranchesView", () => ({ GitBranchesView: () => null }));

describe("FeatureGitTab stash conflicts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGitStatusStore.setState({ byFeature: {}, errorByFeature: {}, watcherEpoch: {} });
    useGitStatusStore.getState().setStatus({
      feature_id: 9,
      current_branch: "feature/stash",
      target_branch: "origin/main",
      uncommitted_count: 0,
      staged_count: 0,
      unstaged_count: 0,
      untracked_count: 0,
      ahead_of_remote: 0,
      behind_remote: 0,
      ahead_of_target: 0,
      behind_target: 0,
      target_resolved: true,
      conflict_count: 0,
      operation: null,
      has_remote: true,
      compare_url: null,
      computed_at: 1,
    });
  });

  it("selects and persists Uncommitted after an apply/pop conflict outcome", async () => {
    const { user } = render(<FeatureGitTab featureId={9} projectId={3} />);
    expect(screen.getByRole("tab", { name: "Stashes" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("button", { name: "Report stash conflict" }));

    expect(screen.getByRole("tab", { name: "Uncommitted" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mocks.setFeatureSetting).toHaveBeenCalledWith({
      id: 9,
      data: { key: "git_view_mode", value: "uncommitted" },
    });
  });
});
