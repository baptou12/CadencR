import { createElement, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_MODEL } from "../shared/models";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { AGENT_ICONS } from "./agent-icons";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useGetWorkspaceModelSettings,
  useSetWorkspaceModelSetting,
  getGetWorkspaceModelSettingsQueryKey,
  useGetProjectModelSettings,
  useSetProjectModelSetting,
  getGetProjectModelSettingsQueryKey,
  useGetFeatureModelSettings,
  getGetFeatureModelSettingsQueryKey,
  useSetFeatureModelSetting,
  useListModels,
} from "../api/generated";

const AGENT_TYPES = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
type AgentType = (typeof AGENT_TYPES)[number];

const AGENT_LABELS: Record<AgentType, string> = {
  plan: "Plan",
  prd: "PRD",
  execute: "Execute",
  risk: "Risk",
  review: "Review",
  "review-fixer": "Review Fixer",
  session: "Session",
  qa: "QA",
  retro: "Retro",
};

const INHERIT_VALUE = "__inherit__";

interface ModelSelectorProps {
  level: "global" | "project" | "feature";
  projectId?: number;
  featureId?: number;
}

export function ModelSelector({ level, projectId, featureId }: ModelSelectorProps) {
  const queryClient = useQueryClient();
  const availableModels = useListModels();
  const models = availableModels.data ?? [];

  const globalSettings = useGetWorkspaceModelSettings({
    enabled: level === "global",
  });
  const projectSettings = useGetProjectModelSettings(projectId ?? 0, {
    enabled: level === "project" && projectId != null,
  });
  const featureSettings = useGetFeatureModelSettings(featureId ?? 0, {
    enabled: level === "feature" && featureId != null,
  });

  const parentGlobalSettings = useGetWorkspaceModelSettings({
    enabled: level !== "global",
  });
  const parentProjectSettings = useGetProjectModelSettings(projectId ?? 0, {
    enabled: level === "feature" && projectId != null,
  });

  const globalMutation = useSetWorkspaceModelSetting({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetWorkspaceModelSettingsQueryKey() }),
  });
  const projectMutation = useSetProjectModelSetting({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProjectModelSettingsQueryKey(projectId ?? 0) }),
  });
  const featureMutation = useSetFeatureModelSetting({
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId ?? 0) }),
  });

  const settings =
    level === "global"
      ? globalSettings.data
      : level === "project"
        ? projectSettings.data
        : featureSettings.data;

  const [openFor, setOpenFor] = useState<AgentType | null>(null);

  function getEffectiveModel(agentType: AgentType): string {
    if (level === "feature") {
      const projectVal = parentProjectSettings.data?.[agentType];
      if (projectVal) return projectVal;
      const globalVal = parentGlobalSettings.data?.[agentType];
      if (globalVal) return globalVal;
    }
    if (level === "project") {
      const globalVal = parentGlobalSettings.data?.[agentType];
      if (globalVal) return globalVal;
    }
    return DEFAULT_MODEL;
  }

  function getModelLabel(modelId: string): string {
    return models.find((m) => m.id === modelId)?.label ?? modelId;
  }

  function handleChange(agentType: AgentType, value: string) {
    const modelId = value === INHERIT_VALUE ? "" : value;
    if (level === "global") {
      globalMutation.mutate({ agentType, modelId: modelId || DEFAULT_MODEL });
    } else if (level === "project" && projectId != null) {
      projectMutation.mutate({ projectId, modelType: agentType, model: modelId });
    } else if (level === "feature" && featureId != null) {
      featureMutation.mutate({ featureId: featureId!, modelType: agentType, model: modelId });
    }
    setOpenFor(null);
  }

  function getCurrentValue(agentType: AgentType): string {
    const val = settings?.[agentType];
    if (level === "global") {
      return val ?? DEFAULT_MODEL;
    }
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function getDisplayLabel(agentType: AgentType): string {
    const current = getCurrentValue(agentType);
    if (current === INHERIT_VALUE) {
      return `Inherit (${getModelLabel(getEffectiveModel(agentType))})`;
    }
    return getModelLabel(current);
  }

  const isLoading =
    (level === "global" && globalSettings.isLoading) ||
    (level === "project" && projectSettings.isLoading) ||
    (level === "feature" && featureSettings.isLoading);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  return (
    <div className="space-y-2">
      {AGENT_TYPES.map((agentType) => {
        const currentValue = getCurrentValue(agentType);
        const effectiveModel = getEffectiveModel(agentType);

        return (
          <div key={agentType} className="flex items-center gap-3">
            <label className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {createElement(AGENT_ICONS[agentType], { className: "size-3.5" })}
              {AGENT_LABELS[agentType]}
            </label>
            <Popover open={openFor === agentType} onOpenChange={(open) => setOpenFor(open ? agentType : null)}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="h-7 flex-1 justify-between px-2 text-xs font-normal"
                >
                  <span className="truncate">{getDisplayLabel(agentType)}</span>
                  <ChevronsUpDownIcon className="ml-1 size-3 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search models..." className="h-8 text-xs" />
                  <CommandList>
                    <CommandEmpty className="py-2 text-center text-xs">No model found.</CommandEmpty>
                    <CommandGroup>
                      {level !== "global" && (
                        <CommandItem
                          value={INHERIT_VALUE}
                          onSelect={() => handleChange(agentType, INHERIT_VALUE)}
                          className="text-xs"
                        >
                          <CheckIcon className={cn("mr-2 size-3", currentValue === INHERIT_VALUE ? "opacity-100" : "opacity-0")} />
                          Inherit ({getModelLabel(effectiveModel)})
                        </CommandItem>
                      )}
                      {models.map((model) => (
                        <CommandItem
                          key={model.id}
                          value={model.id}
                          keywords={[model.label]}
                          onSelect={() => handleChange(agentType, model.id)}
                          className="text-xs"
                        >
                          <CheckIcon className={cn("mr-2 size-3", currentValue === model.id ? "opacity-100" : "opacity-0")} />
                          {model.label}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        );
      })}
    </div>
  );
}
