// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  getListFeatureActivityQueryKey,
  getListFeaturesQueryKey,
  type Feature,
} from "@/api/generated";
import { useTerminalStore } from "@/hooks/useTerminalState";
import { queryClient } from "@/lib/queryClient";
import { handleAgentArchived } from "@/lib/agent-archived";

const navigate = vi.hoisted(() => vi.fn(async () => undefined));
const closeFeatureSession = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));
vi.mock("@/router", () => ({ router: { navigate } }));
vi.mock("@/components/project-feature-navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/project-feature-navigation")>()),
  closeFeatureSession,
}));

function feature(id: number, status: Feature["status"] = "active"): Feature {
  return { id, project_id: 1, title: `F${id}`, status } as Feature;
}

function event(cleanup: Record<string, unknown>, ids = [2]) {
  return {
    project_id: 1,
    feature_id: 2,
    title: "Archive target",
    archived_by: "Orchestrator",
    archived_feature_ids: ids,
    cleanup,
  };
}

describe("handleAgentArchived", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    window.location.hash = "";
  });

  it("toasts the finished cleanup and runs the dialog's local teardown", () => {
    const closePanel = vi.spyOn(useTerminalStore.getState(), "closePanel");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    queryClient.setQueryData(getListFeaturesQueryKey({ project_id: 1 }), [feature(1), feature(2)]);

    handleAgentArchived(
      event({
        terminals: { status: "done", detail: "killed 1 shell(s)" },
        worktree: { status: "done" },
      }),
    );

    expect(toast.success).toHaveBeenCalledWith("Orchestrator archived “Archive target”", {
      description: "Cleanup finished: terminals, worktree.",
    });
    expect(closeFeatureSession).toHaveBeenCalledWith(2);
    expect(closePanel).toHaveBeenCalledWith(2);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getListFeatureActivityQueryKey({ project_id: 1, include_archived: true }),
    });
    const cached = queryClient.getQueryData<Feature[]>(getListFeaturesQueryKey({ project_id: 1 }));
    expect(cached?.find((candidate) => candidate.id === 2)?.status).toBe("archived");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("warns about a blocked step and names the relatives archived alongside", () => {
    handleAgentArchived(
      event(
        { branch: { status: "blocked", reason: "unmerged_branch", message: "Branch not merged" } },
        [2, 3],
      ),
    );

    expect(toast.warning).toHaveBeenCalledWith(
      "Orchestrator archived “Archive target” and 1 related session, but cleanup is incomplete",
      { description: "Branch: Branch not merged" },
    );
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("leaves the archived conversation for its neighbour when it is on screen", async () => {
    queryClient.setQueryData(getListFeaturesQueryKey({ project_id: 1 }), [
      feature(1),
      feature(2),
      feature(4, "archived"),
    ]);
    window.location.hash = "#/ws-session/ws-feature-2?featureId=2&projectId=1";

    handleAgentArchived(event({}));

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: "1", featureId: "1" },
      }),
    );
  });

  it("reports an unreadable event instead of dropping it", () => {
    handleAgentArchived({ feature_id: "2" });

    expect(toast.error).toHaveBeenCalledWith("An agent archived a session", {
      description: "Cadencr could not read the archive details; the session list was refreshed.",
    });
  });
});
