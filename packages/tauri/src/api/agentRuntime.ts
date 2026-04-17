import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customInstance } from "./client";
import { AGENT_TYPES, DEFAULT_PROVIDER, type AgentTypeSetting } from "../shared/models";

export interface RuntimeModelOption {
  id: string;
  label: string;
  description?: string;
  supports_effort?: boolean;
  supported_effort_levels?: ("low" | "medium" | "high" | "xhigh" | "max")[];
  supports_adaptive_thinking?: boolean;
  supports_fast_mode?: boolean;
  supports_auto_mode?: boolean;
}

export interface RuntimeProviderOption {
  id: string;
  label: string;
  status: "available" | "coming_soon";
  models: RuntimeModelOption[];
  default_model: string | null;
}

export interface AgentCatalog {
  default_provider: string;
  providers: RuntimeProviderOption[];
}

export type ProviderSettings = Record<AgentTypeSetting, string>;

interface ProviderMutationCallbacks<TVariables> {
  onSuccess?: (_data: unknown, variables: TVariables) => void;
  onError?: (_error: unknown, variables: TVariables) => void;
}

function defaultProviderSettings(): ProviderSettings {
  return Object.fromEntries(AGENT_TYPES.map((agentType) => [agentType, DEFAULT_PROVIDER])) as ProviderSettings;
}

export function useAgentCatalog() {
  return useQuery({
    queryKey: ["agent-catalog"],
    queryFn: () => customInstance<AgentCatalog>({ method: "GET", url: "/api/agent-catalog" }),
  });
}

export function useGetWorkspaceProviderSettings(enabled = true) {
  return useQuery({
    queryKey: ["workspace", "provider-settings"],
    queryFn: async () => {
      const data = await customInstance<ProviderSettings>({ method: "GET", url: "/api/workspace/provider-settings" });
      return { ...defaultProviderSettings(), ...data };
    },
    enabled,
  });
}

export function useSetWorkspaceProviderSetting(
  callbacks?: ProviderMutationCallbacks<{ agentType: AgentTypeSetting; providerId: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ agentType, providerId }: { agentType: AgentTypeSetting; providerId: string }) =>
      customInstance<{ value: string }>({
        method: "PUT",
        url: "/api/workspace/provider-settings",
        data: { agent_type: agentType, provider_id: providerId },
      }),
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace", "provider-settings"] });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: (error, variables) => callbacks?.onError?.(error, variables),
  });
}

export function useGetProjectProviderSettings(projectId: number, enabled = true) {
  return useQuery({
    queryKey: ["projects", "provider-settings", projectId],
    queryFn: async () => {
      const data = await customInstance<ProviderSettings>({ method: "GET", url: `/api/projects/${projectId}/provider-settings` });
      return { ...defaultProviderSettings(), ...data };
    },
    enabled,
  });
}

export function useSetProjectProviderSetting(
  callbacks?: ProviderMutationCallbacks<{ projectId: number; providerType: AgentTypeSetting; provider: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, providerType, provider }: { projectId: number; providerType: AgentTypeSetting; provider: string }) =>
      customInstance<{ success: boolean }>({
        method: "PUT",
        url: `/api/projects/${projectId}/provider-settings`,
        data: { provider_type: providerType, provider },
      }),
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["projects", "provider-settings", variables.projectId] });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: (error, variables) => callbacks?.onError?.(error, variables),
  });
}

export function useGetFeatureProviderSettings(featureId: number, enabled = true) {
  return useQuery({
    queryKey: ["features", "provider-settings", featureId],
    queryFn: async () => {
      const data = await customInstance<ProviderSettings>({ method: "GET", url: `/api/features/${featureId}/provider-settings` });
      return { ...defaultProviderSettings(), ...data };
    },
    enabled,
  });
}

export function useSetFeatureProviderSetting(
  callbacks?: ProviderMutationCallbacks<{ featureId: number; providerType: AgentTypeSetting; provider: string }>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ featureId, providerType, provider }: { featureId: number; providerType: AgentTypeSetting; provider: string }) =>
      customInstance<{ success: boolean }>({
        method: "PUT",
        url: `/api/features/${featureId}/provider-settings`,
        data: { provider_type: providerType, provider },
      }),
    onSuccess: async (data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["features", "provider-settings", variables.featureId] });
      callbacks?.onSuccess?.(data, variables);
    },
    onError: (error, variables) => callbacks?.onError?.(error, variables),
  });
}
