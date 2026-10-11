import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import type {
  AllocatedPort,
  Feature,
  FeatureWorktreeInfo,
  GitStats,
  PrStatusSnapshot,
} from "@/api/generated";
import { DEFAULT_SIDEBAR_CONFIG, type SidebarConfig } from "@/lib/sidebar-config";
import { useSidebarConfigStore } from "@/stores/sidebar-config-store";
import { FeatureRowMetaLine } from "./ProjectFeatureRowParts";

vi.mock("@/components/ShortcutTooltip", () => ({
  ShortcutTooltip: ({ children }: { children: unknown }) => children,
}));

function configure(overrides: Partial<SidebarConfig>): void {
  useSidebarConfigStore.setState({ config: { ...DEFAULT_SIDEBAR_CONFIG, ...overrides } });
}

beforeEach(() => configure({}));

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: 5,
    project_id: 1,
    title: "A feature",
    status: "active",
    type: "ws-session",
    label: null,
    is_pinned: false,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  } as Feature;
}

function snapshot(overrides: Partial<PrStatusSnapshot> = {}): PrStatusSnapshot {
  return {
    setup_required: false,
    feature_id: 5,
    fetched_at: 1,
    error: null,
    ci: { state: "none", checks: [] },
    pr: null,
    ...overrides,
  };
}

function port(overrides: Partial<AllocatedPort> = {}): AllocatedPort {
  return {
    port: 3000,
    pid: 999,
    process: "node",
    source: "agent",
    ...overrides,
  };
}

function renderLine(
  prStatus: PrStatusSnapshot | undefined,
  ports: readonly AllocatedPort[] = [],
  downloadCount = 0,
  extra: { feature?: Feature; worktree?: FeatureWorktreeInfo; gitStats?: GitStats } = {},
) {
  return render(
    <FeatureRowMetaLine
      feature={extra.feature ?? feature()}
      worktree={extra.worktree}
      prStatus={prStatus}
      gitStats={extra.gitStats}
      shellCount={0}
      browserCount={0}
      downloadCount={downloadCount}
      ports={ports}
      onOpenPort={vi.fn()}
    />,
  );
}

describe("FeatureRowMetaLine", () => {
  it("stays a single line when the row has nothing to show", () => {
    renderLine(undefined);

    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("mounts for a forge error even with no proposal, so it can't be swallowed", () => {
    renderLine(snapshot({ error: "Bad credentials" }));

    expect(document.querySelector("[data-feature-meta-line]")).not.toBeNull();
    expect(screen.getByLabelText("Forge status error: Bad credentials")).toBeInTheDocument();
  });

  it("stays hidden for a clean snapshot with neither proposal nor error", () => {
    renderLine(snapshot());

    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("mounts for an allocated port even when the row has nothing else to show", () => {
    renderLine(undefined, [port()]);

    expect(document.querySelector("[data-feature-meta-line]")).not.toBeNull();
    expect(screen.getByLabelText("Port 3000 in use")).toBeInTheDocument();
  });

  it("summarises several ports on one badge", () => {
    renderLine(undefined, [port(), port({ port: 5173, pid: 1000 })]);

    expect(screen.getByLabelText("Ports 3000, 5173 in use")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("shows active downloads independently from browser tabs", () => {
    renderLine(undefined, [], 2);

    expect(screen.getByLabelText("2 browser downloads active")).toHaveTextContent("2");
    expect(screen.queryByLabelText(/browser tabs open/)).not.toBeInTheDocument();
  });
});

describe("FeatureRowMetaLine display options", () => {
  const worktree = {
    feature_id: 5,
    worktree_path: "/repo/.worktrees/fix-login",
    worktree_branch: "fix/login",
    directory_exists: true,
    is_default_branch: false,
    is_main_worktree: false,
    live: true,
  } satisfies FeatureWorktreeInfo;
  const stats: GitStats = { insertions: 4, deletions: 2, files_changed: 1 };

  it("shows the branch only when asked to", () => {
    renderLine(undefined, [], 0, { worktree });
    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();

    configure({ branch: true });
    renderLine(undefined, [], 0, { worktree });
    expect(document.querySelector("[data-feature-branch]")).toHaveTextContent("fix/login");
  });

  it("drops each hidden element, and the line once nothing is left", () => {
    configure({ diff: false, ports: false, activity: false, pr: false });
    renderLine(snapshot({ error: "Bad credentials" }), [port()], 2, { gitStats: stats });
    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("renders the label as a dot or not at all", () => {
    configure({ label: "dot" });
    const { unmount } = renderLine(undefined, [], 0, { feature: feature({ label: "bug" }) });
    expect(screen.getByRole("img", { name: "Label: bug" })).toHaveAttribute("title", "bug");
    unmount();

    configure({ label: "hidden" });
    renderLine(undefined, [], 0, { feature: feature({ label: "bug" }) });
    expect(document.querySelector("[data-feature-meta-line]")).toBeNull();
  });

  it("names the model on this line when the provider shows logo + model", () => {
    configure({ provider: "logo_model" });
    renderLine(undefined, [], 0, {
      feature: feature({ runtime_provider: "codex_cli", model_session: "gpt-5.4" }),
    });
    expect(document.querySelector("[data-feature-model]")).toHaveTextContent("gpt-5.4");
  });
});
