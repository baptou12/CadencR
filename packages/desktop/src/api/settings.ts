import { useQuery } from "@tanstack/react-query";
import { customInstance } from "./client";

export interface SettingEntry {
  key: string;
  value?: string | null;
}

export function getWorkspaceSettingsQueryKey() {
  return ["workspace", "settings"] as const;
}

export function useGetWorkspaceSettings() {
  return useQuery({
    queryKey: getWorkspaceSettingsQueryKey(),
    queryFn: () =>
      customInstance<SettingEntry[]>({ method: "GET", url: "/api/workspace/settings" }),
  });
}

export function settingsArrayToMap(settings: SettingEntry[] | undefined): Record<string, string> {
  return Object.fromEntries((settings ?? []).map((entry) => [entry.key, entry.value ?? ""]));
}
