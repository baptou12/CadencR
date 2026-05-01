import { invalidateFeatureQueries } from "@/lib/featureUpdated";
import { type CommandsListPayload } from "@/lib/ws-envelope";
import type { SlashCommand } from "@/hooks/useSlashCommand";
import type { WorkflowState } from "@/types/workflow";

type WorkflowSetFn = (
  partial: Partial<WorkflowState> | ((state: WorkflowState) => Partial<WorkflowState>),
) => void;

export function handleWorkflowCrossDomainEvent(
  domain: string,
  action: string,
  ref: string | undefined,
  payload: Record<string, unknown>,
  set: WorkflowSetFn,
  get: () => WorkflowState,
): boolean {
  if (domain === "session" && action === "feature.renamed") {
    const title = payload.title as string | undefined;
    if (title) set({ featureTitle: title });
    return true;
  }

  if (domain === "session" && action === "feature.autonaming") {
    const featureIdPayload = payload.feature_id as number | undefined;
    const inProgress = payload.in_progress === true;
    if (featureIdPayload != null && featureIdPayload === get().featureId) {
      set({ isAutoNaming: inProgress });
    }
    return true;
  }

  if (domain === "feature" && action === "updated") {
    const changed = (payload.changed ?? []) as string[];
    const featureId = get().featureId;
    if (featureId) invalidateFeatureQueries(featureId, changed);
    return true;
  }

  if (domain === "commands" && action === "list") {
    const p = payload as unknown as CommandsListPayload;
    if (!ref || ref !== get().slashCommandsRequestRef) return true;
    const cmds: SlashCommand[] = (p.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description ?? "",
    }));
    set({
      slashCommands: cmds,
      slashCommandsLoading: false,
    });
    return true;
  }

  return false;
}
