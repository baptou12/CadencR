import { useCallback } from "react";
import { trpc } from "@/trpc";
import { DEFAULT_MODEL } from "../../shared/models";
import type { AgentType } from "../../main/agents/types";
import { useGetWorkspaceModelSettings } from "../api/generated";

/**
 * Hook that resolves the effective model for an agent type through the
 * settings hierarchy: feature → project → global → DEFAULT_MODEL.
 *
 * Returns the resolved model ID and a mutation to update the feature-level setting.
 */
export function useResolvedModel(featureId: number, projectId: number) {
  const utils = trpc.useUtils();

  const featureSettings = trpc.features.getModelSettings.useQuery({ featureId });
  const projectSettings = trpc.projects.getModelSettings.useQuery({ projectId });
  const globalSettings = useGetWorkspaceModelSettings();

  const setModelMutation = trpc.features.setModelSetting.useMutation({
    onSuccess: () => utils.features.getModelSettings.invalidate(),
  });

  /** Resolve model through the hierarchy for display */
  const resolveModel = useCallback(
    (agentType: AgentType): string => {
      const featureVal = featureSettings.data?.[agentType];
      if (featureVal) return featureVal;

      const projectVal = projectSettings.data?.[agentType];
      if (projectVal) return projectVal;

      const globalVal = globalSettings.data?.[agentType];
      if (globalVal) return globalVal;

      return DEFAULT_MODEL;
    },
    [featureSettings.data, projectSettings.data, globalSettings.data],
  );

  const handleModelChange = useCallback(
    (agentType: AgentType, modelId: string) => {
      setModelMutation.mutate({ featureId, agentType, modelId });
    },
    [featureId, setModelMutation],
  );

  return { resolveModel, handleModelChange };
}
