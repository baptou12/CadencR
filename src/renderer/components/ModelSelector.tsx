import { createElement } from "react";
import { trpc } from "../trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { AGENT_ICONS } from "./agent-icons";
import { CLAUDE_MODELS } from "../../shared/models";

const AGENT_TYPES = ["plan", "brainstorm", "execute", "risk", "review"] as const;
type AgentType = (typeof AGENT_TYPES)[number];

const AGENT_LABELS: Record<AgentType, string> = {
  plan: "Plan",
  brainstorm: "Brainstorm",
  execute: "Execute",
  risk: "Risk",
  review: "Review",
};

const INHERIT_VALUE = "__inherit__";

interface ModelSelectorProps {
  level: "global" | "project" | "feature";
  projectId?: number;
  featureId?: number;
}

export function ModelSelector({ level, projectId, featureId }: ModelSelectorProps) {
  const utils = trpc.useUtils();

  // Fetch model settings for this level
  const globalSettings = trpc.settings.getModelSettings.useQuery(undefined, {
    enabled: level === "global",
  });
  const projectSettings = trpc.projects.getModelSettings.useQuery(
    { projectId: projectId! },
    { enabled: level === "project" && projectId != null },
  );
  const featureSettings = trpc.features.getModelSettings.useQuery(
    { featureId: featureId! },
    { enabled: level === "feature" && featureId != null },
  );

  // Also fetch parent settings to show effective model as placeholder
  const parentGlobalSettings = trpc.settings.getModelSettings.useQuery(undefined, {
    enabled: level !== "global",
  });
  const parentProjectSettings = trpc.projects.getModelSettings.useQuery(
    { projectId: projectId! },
    { enabled: level === "feature" && projectId != null },
  );

  const globalMutation = trpc.settings.setModelSetting.useMutation({
    onSuccess: () => utils.settings.getModelSettings.invalidate(),
  });
  const projectMutation = trpc.projects.setModelSetting.useMutation({
    onSuccess: () => utils.projects.getModelSettings.invalidate(),
  });
  const featureMutation = trpc.features.setModelSetting.useMutation({
    onSuccess: () => utils.features.getModelSettings.invalidate(),
  });

  const settings =
    level === "global"
      ? globalSettings.data
      : level === "project"
        ? projectSettings.data
        : featureSettings.data;

  function getEffectiveModel(agentType: AgentType): string {
    // Resolve through parent hierarchy for placeholder display
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
    return "claude-opus-4-6";
  }

  function getModelLabel(modelId: string): string {
    return CLAUDE_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
  }

  function handleChange(agentType: AgentType, value: string) {
    const modelId = value === INHERIT_VALUE ? "" : value;
    if (level === "global") {
      globalMutation.mutate({ agentType, modelId: modelId || "claude-opus-4-6" });
    } else if (level === "project" && projectId != null) {
      projectMutation.mutate({ projectId, agentType, modelId });
    } else if (level === "feature" && featureId != null) {
      featureMutation.mutate({ featureId, agentType, modelId });
    }
  }

  function getCurrentValue(agentType: AgentType): string {
    const val = settings?.[agentType];
    if (level === "global") {
      return val ?? "claude-opus-4-6";
    }
    // For project/feature levels, empty or default means "inherit"
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  const isLoading =
    (level === "global" && globalSettings.isLoading) ||
    (level === "project" && projectSettings.isLoading) ||
    (level === "feature" && featureSettings.isLoading);

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {AGENT_TYPES.map((agentType) => {
        const currentValue = getCurrentValue(agentType);
        const effectiveModel = getEffectiveModel(agentType);

        return (
          <div key={agentType} className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium">
              {createElement(AGENT_ICONS[agentType], { className: "size-3.5" })}
              {AGENT_LABELS[agentType]}
            </label>
            <Select value={currentValue} onValueChange={(v) => handleChange(agentType, v)}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    level !== "global"
                      ? `Inherit (${getModelLabel(effectiveModel)})`
                      : undefined
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {level !== "global" && (
                  <SelectItem value={INHERIT_VALUE}>
                    Inherit default ({getModelLabel(effectiveModel)})
                  </SelectItem>
                )}
                {CLAUDE_MODELS.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
