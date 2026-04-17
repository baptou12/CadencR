import { createElement, useMemo } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  AGENT_TYPES,
  DEFAULT_PROVIDER,
  resolveRuntimeSelection,
  type AgentTypeSetting,
  type RuntimeSelection,
} from "../shared/models";
import {
  useAgentCatalog,
  useGetFeatureProviderSettings,
  useGetProjectProviderSettings,
  useGetWorkspaceProviderSettings,
  useSetFeatureProviderSetting,
  useSetProjectProviderSetting,
  useSetWorkspaceProviderSetting,
} from "../api/agentRuntime";
import { AGENT_ICONS } from "./agent-icons";
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
} from "../api/generated";
import { ProviderIcon } from "@/lib/provider-icons";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

type AgentType = AgentTypeSetting;
const INHERIT_VALUE = "__inherit__";

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

interface ModelSelectorProps {
  level: "global" | "project" | "feature";
  projectId?: number;
  featureId?: number;
}

export function ModelSelector({ level, projectId, featureId }: ModelSelectorProps) {
  const queryClient = useQueryClient();
  const agentCatalog = useAgentCatalog();

  const globalSettings = useGetWorkspaceModelSettings({ enabled: level === "global" });
  const projectSettings = useGetProjectModelSettings(projectId ?? 0, {
    enabled: level === "project" && projectId != null,
  });
  const featureSettings = useGetFeatureModelSettings(featureId ?? 0, {
    enabled: level === "feature" && featureId != null,
  });

  const parentGlobalSettings = useGetWorkspaceModelSettings({ enabled: level !== "global" });
  const parentProjectSettings = useGetProjectModelSettings(projectId ?? 0, {
    enabled: level === "feature" && projectId != null,
  });

  const globalProviderSettings = useGetWorkspaceProviderSettings(level === "global");
  const projectProviderSettings = useGetProjectProviderSettings(projectId ?? 0, level === "project" && projectId != null);
  const featureProviderSettings = useGetFeatureProviderSettings(featureId ?? 0, level === "feature" && featureId != null);
  const parentGlobalProviderSettings = useGetWorkspaceProviderSettings(level !== "global");
  const parentProjectProviderSettings = useGetProjectProviderSettings(projectId ?? 0, level === "feature" && projectId != null);

  const globalMutation = useSetWorkspaceModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceModelSettingsQueryKey() });
      toast.success("Settings saved");
    },
  });
  const projectMutation = useSetProjectModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetProjectModelSettingsQueryKey(projectId ?? 0) });
      toast.success("Settings saved");
    },
  });
  const featureMutation = useSetFeatureModelSetting({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getGetFeatureModelSettingsQueryKey(featureId ?? 0) });
      toast.success("Settings saved");
    },
  });

  const handleProviderMutationSuccess = () => {
    toast.success("Settings saved");
  };
  const handleProviderMutationError = () => {
    toast.error("Failed to save provider setting");
  };

  const globalProviderMutation = useSetWorkspaceProviderSetting({
    onSuccess: handleProviderMutationSuccess,
    onError: handleProviderMutationError,
  });
  const projectProviderMutation = useSetProjectProviderSetting({
    onSuccess: handleProviderMutationSuccess,
    onError: handleProviderMutationError,
  });
  const featureProviderMutation = useSetFeatureProviderSetting({
    onSuccess: handleProviderMutationSuccess,
    onError: handleProviderMutationError,
  });

  const settings =
    level === "global" ? globalSettings.data : level === "project" ? projectSettings.data : featureSettings.data;
  const providerSettings =
    level === "global" ? globalProviderSettings.data : level === "project" ? projectProviderSettings.data : featureProviderSettings.data;

  const isLoading =
    (level === "global" && globalSettings.isLoading) ||
    (level === "project" && projectSettings.isLoading) ||
    (level === "feature" && featureSettings.isLoading) ||
    (level === "global" && globalProviderSettings.isLoading) ||
    (level === "project" && projectProviderSettings.isLoading) ||
    (level === "feature" && featureProviderSettings.isLoading) ||
    agentCatalog.isLoading;

  if (isLoading) {
    return <div className="text-sm text-muted-foreground">Loading model settings...</div>;
  }

  if (agentCatalog.error) {
    return <div className="text-sm text-destructive">Failed to load provider catalog.</div>;
  }

  function getSelection(agentType: AgentType, targetLevel: "global" | "project" | "feature"): RuntimeSelection {
    return resolveRuntimeSelection({
      agentType,
      providers: agentCatalog.data?.providers,
      defaultProviderId: agentCatalog.data?.default_provider ?? DEFAULT_PROVIDER,
      globalModels: globalSettings.data ?? parentGlobalSettings.data,
      globalProviders: globalProviderSettings.data ?? parentGlobalProviderSettings.data,
      ...(targetLevel !== "global"
        ? {
            projectModels: projectSettings.data ?? parentProjectSettings.data,
            projectProviders: projectProviderSettings.data ?? parentProjectProviderSettings.data,
          }
        : {}),
      ...(targetLevel === "feature"
        ? {
            featureModels: featureSettings.data,
            featureProviders: featureProviderSettings.data,
          }
        : {}),
    });
  }

  function getEffectiveSelection(agentType: AgentType): RuntimeSelection {
    if (level === "global") return getSelection(agentType, "global");
    if (level === "project") return getSelection(agentType, "project");
    return getSelection(agentType, "feature");
  }

  function getCurrentValue(agentType: AgentType): string {
    const val = settings?.[agentType];
    if (level === "global") return getSelection(agentType, "global").modelId;
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function getCurrentProviderValue(agentType: AgentType): string {
    const val = providerSettings?.[agentType];
    if (level === "global") return getSelection(agentType, "global").providerId;
    return val && val !== "" ? val : INHERIT_VALUE;
  }

  function isModelSelected(agentType: AgentType, providerId: string, modelId: string): boolean {
    const selection = getEffectiveSelection(agentType);
    return providerId === selection.providerId && modelId === selection.modelId;
  }

  function handleChange(agentType: AgentType, value: string): void {
    const modelId = value === INHERIT_VALUE ? "" : value;
    if (level === "global") {
      globalMutation.mutate({
        agentType,
        modelId: modelId || getSelection(agentType, "global").modelId,
      });
    } else if (level === "project" && projectId != null) {
      projectMutation.mutate({ projectId, modelType: agentType, model: modelId });
    } else if (level === "feature" && featureId != null) {
      featureMutation.mutate({ featureId, modelType: agentType, model: modelId });
    }
  }

  function handleProviderChange(agentType: AgentType, value: string): void {
    const providerId = value === INHERIT_VALUE ? "" : value;
    const resolvedProviderId = providerId || DEFAULT_PROVIDER;
    const selectedProvider = agentCatalog.data?.providers.find((provider) => provider.id === resolvedProviderId);
    if (providerId !== "" && (!selectedProvider || selectedProvider.status !== "available")) {
      return;
    }

    if (level === "global") {
      globalProviderMutation.mutate({ agentType, providerId: resolvedProviderId });
    } else if (level === "project" && projectId != null) {
      projectProviderMutation.mutate({ projectId, providerType: agentType, provider: providerId });
    } else if (level === "feature" && featureId != null) {
      featureProviderMutation.mutate({ featureId, providerType: agentType, provider: providerId });
    }
  }

  const providers = useMemo(() => (agentCatalog.data?.providers ?? []).map((provider) => ({
    id: provider.id,
    label: provider.status === "available" ? provider.label : `${provider.label} (Coming soon)`,
    providerId: provider.id,
    disabled: provider.status !== "available",
    models: provider.models,
  })), [agentCatalog.data]);

  function getSelectedProvider(agentType: AgentType): string {
    return getEffectiveSelection(agentType).providerId;
  }

  function getSelectedModel(agentType: AgentType): string {
    return getEffectiveSelection(agentType).modelId;
  }

  function getProviderLabel(providerId: string): string {
    return providers.find((provider) => provider.id === providerId)?.label ?? providerId;
  }

  function getModelLabel(providerId: string, modelId: string): string {
    return (
      agentCatalog.data?.providers
        .find((provider) => provider.id === providerId)
        ?.models.find((model) => model.id === modelId)?.label ?? modelId
    );
  }

  function getModelDescription(providerId: string, modelId: string): string | undefined {
    return agentCatalog.data?.providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId)?.description;
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card/30 p-2">
      {AGENT_TYPES.map((agentType) => (
        <div
          key={agentType}
          className="flex flex-col gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:gap-3"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground">
              {createElement(AGENT_ICONS[agentType], { className: "size-4" })}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">
                {AGENT_LABELS[agentType] ?? agentType}
              </div>
              <div className="text-[11px] text-muted-foreground sm:max-w-[180px]">
                {level === "global"
                  ? "Default"
                  : getCurrentProviderValue(agentType) === INHERIT_VALUE || getCurrentValue(agentType) === INHERIT_VALUE
                    ? "Inherited"
                    : "Override"}
              </div>
            </div>
          </div>
          <div className="min-w-0 w-full sm:w-auto sm:shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="h-10 w-full justify-between gap-3 rounded-lg border-border/70 bg-background/80 px-3 text-left text-xs font-normal shadow-sm sm:min-w-[260px] sm:max-w-[360px]"
                  title={getModelDescription(getSelectedProvider(agentType), getSelectedModel(agentType))}
                >
                  <span className="flex min-w-0 items-center gap-2.5 overflow-hidden">
                    <ProviderIcon
                      providerId={getSelectedProvider(agentType)}
                      alt={AGENT_LABELS[agentType]}
                      className="size-4 shrink-0 rounded-sm"
                    />
                    <span className="min-w-0 truncate">
                      <span className="truncate text-sm text-foreground">
                        {getProviderLabel(getSelectedProvider(agentType))} /{" "}
                        {getModelLabel(getSelectedProvider(agentType), getSelectedModel(agentType))}
                      </span>
                      {level !== "global" && (
                        <span className="ml-1 hidden truncate text-[11px] text-muted-foreground sm:inline">
                          {(getCurrentProviderValue(agentType) === INHERIT_VALUE || getCurrentValue(agentType) === INHERIT_VALUE)
                            ? "Inherited"
                            : "Override"}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[260px]">
                <DropdownMenuLabel className="text-xs">Provider</DropdownMenuLabel>
                {level !== "global" && (
                  <DropdownMenuItem onClick={() => handleProviderChange(agentType, "__inherit__")} className="text-xs">
                    {getCurrentProviderValue(agentType) === "__inherit__" && <CheckIcon className="size-3 text-violet-400" />}
                    Inherit provider
                  </DropdownMenuItem>
                )}
                {providers.map((provider) => (
                  <DropdownMenuSub key={provider.id}>
                    <DropdownMenuSubTrigger
                      className="text-xs data-[disabled]:text-muted-foreground"
                      disabled={provider.disabled}
                    >
                      <ProviderIcon providerId={provider.id} alt={provider.label} className="size-3.5 rounded-sm" />
                      <span className={provider.disabled ? "text-muted-foreground" : undefined}>{provider.label}</span>
                      {provider.id === getEffectiveSelection(agentType).providerId && <CheckIcon className="ml-1 size-3 text-violet-400" />}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-[240px]">
                      <DropdownMenuItem
                        onClick={() => handleProviderChange(agentType, provider.id)}
                        className="text-xs"
                        disabled={provider.disabled}
                      >
                        <ProviderIcon providerId={provider.id} alt={provider.label} className="size-3.5 rounded-sm" />
                        Use {provider.label}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-xs">Model</DropdownMenuLabel>
                      {provider.disabled && (
                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                          Coming soon
                        </DropdownMenuItem>
                      )}
                      {level !== "global" && (
                        <DropdownMenuItem onClick={() => handleChange(agentType, "__inherit__")} className="text-xs">
                          {getCurrentValue(agentType) === "__inherit__" && <CheckIcon className="size-3 text-violet-400" />}
                          Inherit model
                        </DropdownMenuItem>
                      )}
                      {!provider.disabled && provider.models.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onClick={() => {
                            handleProviderChange(agentType, provider.id);
                            handleChange(agentType, model.id);
                          }}
                          className="flex items-start justify-between gap-2 text-xs"
                          title={model.description}
                        >
                          <span className="flex items-start gap-2 min-w-0">
                            <ProviderIcon providerId={provider.id} alt={model.label} className="size-3.5 rounded-sm mt-0.5 shrink-0" />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate text-foreground">{model.label}</span>
                              {model.description && (
                                <span className="truncate text-[11px] text-muted-foreground">{model.description}</span>
                              )}
                            </span>
                          </span>
                          {isModelSelected(agentType, provider.id, model.id) && (
                            <CheckIcon className="size-3 text-violet-400 shrink-0 mt-0.5" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
    </div>
  );
}
