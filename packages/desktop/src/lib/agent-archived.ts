import { toast } from "sonner";
import { z } from "zod";
import {
  getListFeatureActivityQueryKey,
  getListFeaturesQueryKey,
  type Feature,
} from "@/api/generated";
import {
  archiveFeaturesInCachedLists,
  archiveNavigationTarget,
  closeFeatureSession,
  navigateToFeatureIdOrHome,
} from "@/components/project-feature-navigation";
import { useTerminalStore } from "@/hooks/useTerminalState";
import { apiErrorMessage } from "@/lib/api-errors";
import { isViewingFeature } from "@/lib/notify-agent-done";
import { invalidateByUrlPrefix, queryClient } from "@/lib/queryClient";

const stepSchema = z.object({
  status: z.enum(["done", "skipped", "blocked", "failed"]),
  detail: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});

/** `app/agent_archived`: an agent archived a conversation with `project_archive_session`. */
const agentArchivedSchema = z.object({
  project_id: z.number(),
  feature_id: z.number(),
  title: z.string(),
  archived_by: z.string(),
  archived_feature_ids: z.array(z.number()),
  cleanup: z.object({
    terminals: stepSchema.optional(),
    browser_tabs: stepSchema.optional(),
    worktree: stepSchema.optional(),
    branch: stepSchema.optional(),
  }),
});

type AgentArchivedEvent = z.infer<typeof agentArchivedSchema>;
type StepName = keyof AgentArchivedEvent["cleanup"];

const STEP_LABELS: Record<StepName, string> = {
  terminals: "Terminals",
  browser_tabs: "Browser tabs",
  worktree: "Worktree",
  branch: "Branch",
};

/**
 * What the Archive dialog does after its own archive request, for an archive an
 * agent made: update the cached lists, drop the archived conversations' live
 * sessions (and the terminal panes whose shells were killed), leave the
 * conversation if it is on screen, and toast the cleanup outcome. The lists
 * themselves are refetched by the `Updated` feature event of each archived id.
 */
export function handleAgentArchived(payload: unknown): void {
  const parsed = agentArchivedSchema.safeParse(payload);
  if (!parsed.success) {
    void invalidateByUrlPrefix(queryClient, "/api/features");
    toast.error("An agent archived a session", {
      description: "Cadencr could not read the archive details; the session list was refreshed.",
    });
    return;
  }
  const event = parsed.data;
  const archivedIds = new Set(event.archived_feature_ids);
  const viewedId = event.archived_feature_ids.find(isViewingFeature);
  // Read before the cached lists mark the conversations archived.
  const target = archiveNavigationTarget(
    cachedActiveFeatures(event.project_id, viewedId),
    viewedId ?? null,
    archivedIds,
  );
  archiveFeaturesInCachedLists(queryClient, event.archived_feature_ids);
  for (const featureId of event.archived_feature_ids) closeFeatureSession(featureId);
  refreshClosedActivity(event);
  if (target !== undefined) leaveArchivedFeature(event.project_id, target?.id);
  showAgentArchivedToast(event);
}

/** `useCloseFeatureActivity`'s teardown, for the shells and tabs the cleanup closed. */
function refreshClosedActivity({ project_id, feature_id, cleanup }: AgentArchivedEvent): void {
  if (cleanup.terminals?.status === "done") useTerminalStore.getState().closePanel(feature_id);
  if (cleanup.terminals?.status === "done" || cleanup.browser_tabs?.status === "done") {
    void queryClient.invalidateQueries({
      queryKey: getListFeatureActivityQueryKey({ project_id, include_archived: true }),
    });
  }
}

function showAgentArchivedToast(event: AgentArchivedEvent): void {
  const relatives = event.archived_feature_ids.length - 1;
  const title = `${event.archived_by} archived “${event.title}”${
    relatives > 0 ? ` and ${relatives} related ${relatives === 1 ? "session" : "sessions"}` : ""
  }`;
  const steps = (Object.keys(STEP_LABELS) as StepName[]).flatMap((name) => {
    const step = event.cleanup[name];
    return step ? [{ name, step }] : [];
  });
  const problems = steps.filter(
    ({ step }) => step.status === "blocked" || step.status === "failed",
  );
  if (problems.length > 0) {
    const description = problems
      .map(
        ({ name, step }) => `${STEP_LABELS[name]}: ${step.message ?? step.reason ?? step.status}`,
      )
      .join("\n");
    const notify = problems.some(({ step }) => step.status === "failed")
      ? toast.error
      : toast.warning;
    notify(`${title}, but cleanup is incomplete`, { description });
    return;
  }
  const done = steps.filter(({ step }) => step.status === "done");
  toast.success(title, {
    description:
      done.length > 0
        ? `Cleanup finished: ${done.map(({ name }) => STEP_LABELS[name].toLowerCase()).join(", ")}.`
        : undefined,
  });
}

/** The sidebar's active list holding `featureId`, from the cached project lists. */
function cachedActiveFeatures(projectId: number, featureId: number | undefined): Feature[] {
  if (featureId === undefined) return [];
  const list = queryClient
    .getQueriesData<Feature[] | object>({ queryKey: getListFeaturesQueryKey() })
    .map(([, data]) => data)
    .find(
      (data): data is Feature[] =>
        Array.isArray(data) && data.some((feature) => feature.id === featureId),
    );
  return (list ?? []).filter(
    (feature) => feature.project_id === projectId && feature.status === "active",
  );
}

function leaveArchivedFeature(projectId: number, featureId: number | undefined): void {
  // Imported lazily: the router's route tree imports the stores this module is
  // loaded from.
  import("@/router")
    .then(({ router }) => navigateToFeatureIdOrHome(router.navigate, projectId, featureId))
    .catch((error: unknown) => {
      toast.error("Could not leave the archived session", {
        description: apiErrorMessage(error, "Navigation failed"),
      });
    });
}
