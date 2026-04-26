import { useCallback, useMemo } from "react";
import { useResolvedModel } from "@/hooks/useResolvedModel";
import { useAgentCatalog } from "@/api/agentRuntime";
import { useAgentSessionModelState } from "@/components/agent-session/useAgentSessionModelState";
import type { MetaBarProps } from "@/components/agent-session/MetaBar";
import type { ThinkingEffortLevel } from "@/shared/thinking-effort";
import type { AgentType } from "@/types/agent-types";

interface UseMetaBarModelPropsParams {
  featureId: number;
  projectId: number;
  /** The agent type whose model/provider/effort settings this picker reads and writes. */
  agentType: AgentType;
  /**
   * Optional second agent type kept in lockstep with the primary — e.g. on the
   * initial Plan/PRD screen a single picker drives both the `plan` and `prd`
   * feature settings so either button uses the chosen model.
   */
  secondaryAgentType?: AgentType;
}

/** Subset of MetaBar props this hook produces; kept in lockstep with MetaBar via `Pick`. */
export type MetaBarModelProps = Required<
  Pick<
    MetaBarProps,
    | "currentModelId"
    | "currentProviderId"
    | "currentModelLabel"
    | "canChangeProvider"
    | "models"
    | "providers"
    | "supportedThinkingEfforts"
    | "onModelChange"
    | "onProviderChange"
    | "onThinkingEffortChange"
  >
> & {
  currentThinkingEffort?: ThinkingEffortLevel;
};

/**
 * Build the props needed to render `<MetaBar variant="standalone">` as a model
 * picker above a pre-agent kickoff prompt (PlanInputView, NextStepsBar). All
 * writes persist at the feature level via `useResolvedModel`.
 */
export function useMetaBarModelProps(params: UseMetaBarModelPropsParams): MetaBarModelProps {
  const { featureId, projectId, agentType, secondaryAgentType } = params;
  const agentCatalog = useAgentCatalog();
  const {
    resolveModel,
    resolveProvider,
    resolveModelThinkingEffort,
    setModelThinkingEffort,
    handleModelChange,
    handleProviderChange,
  } = useResolvedModel(featureId, projectId);

  const currentModelId = resolveModel(agentType);
  const currentProviderId = resolveProvider(agentType);
  // Thinking effort is keyed by (provider, model) — same effort applies whether
  // this picker is used by `plan`, `prd`, `session`, etc. as long as the model
  // is the same.
  const currentThinkingEffort = resolveModelThinkingEffort(currentProviderId, currentModelId);

  const onModelChange = useCallback(
    (modelId: string) => {
      handleModelChange(agentType, modelId);
      if (secondaryAgentType) handleModelChange(secondaryAgentType, modelId);
    },
    [agentType, secondaryAgentType, handleModelChange],
  );

  const onProviderChange = useCallback(
    (providerId: string) => {
      handleProviderChange(agentType, providerId);
      if (secondaryAgentType) handleProviderChange(secondaryAgentType, providerId);
    },
    [agentType, secondaryAgentType, handleProviderChange],
  );

  const onThinkingEffortChange = useCallback(
    (effort?: ThinkingEffortLevel) => {
      // No agent_type fan-out: the effort lives on the model, so updating once
      // is enough whether or not a `secondaryAgentType` is in play.
      setModelThinkingEffort(currentProviderId, currentModelId, effort);
    },
    [currentProviderId, currentModelId, setModelThinkingEffort],
  );

  const {
    providerOptions,
    activeProviderId,
    visibleModels,
    currentModelLabel,
    canChangeProvider,
    supportedThinkingEfforts,
  } = useAgentSessionModelState({
    agentCatalog: agentCatalog.data,
    currentProviderId,
    currentModelId,
    // Presence of this callback is the only thing useAgentSessionModelState
    // uses it for — it gates `canChangeProvider`.
    onProviderChange,
    blocksLength: 0,
    status: "idle",
  });

  // Memoize so the spread into MetaBar doesn't create a new prop object per render.
  return useMemo(
    () => ({
      currentModelId,
      currentProviderId: activeProviderId,
      currentModelLabel,
      canChangeProvider,
      models: visibleModels,
      providers: providerOptions,
      currentThinkingEffort,
      supportedThinkingEfforts,
      onModelChange,
      onProviderChange,
      onThinkingEffortChange,
    }),
    [
      activeProviderId,
      canChangeProvider,
      currentModelId,
      currentModelLabel,
      currentThinkingEffort,
      onModelChange,
      onProviderChange,
      onThinkingEffortChange,
      providerOptions,
      supportedThinkingEfforts,
      visibleModels,
    ],
  );
}
