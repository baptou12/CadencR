import { useQueryClient } from "@tanstack/react-query";
import {
  getGetProjectSettingsQueryKey,
  useGetProjectSettings,
  useSetProjectSetting,
} from "@/api/generated";
import { DEFAULT_PROJECT_COLOR } from "@/lib/project-colors";

/**
 * Returns the persisted color for a project (or the default if unset).
 *
 * The settings list is fetched once per project per session — `staleTime:
 * Infinity` keeps color dots from triggering a fresh GET on every project-tree
 * mount. The companion `useSetProjectColor` mutation invalidates the same
 * query so a manual color change refetches.
 */
export function useProjectColor(projectId: number): string {
  const { data: settings } = useGetProjectSettings(projectId, {
    query: { staleTime: Infinity },
  });
  const colorSetting = settings?.find((s) => s.key === "color");
  return colorSetting?.value ?? DEFAULT_PROJECT_COLOR;
}

/**
 * Mutation hook for changing the persisted color. Mirrors the orval-generated
 * `useSetProjectSetting` but invalidates the project-settings query on success
 * so the color dots refresh — the global 30 s `staleTime` would otherwise
 * keep the stale dot visible for half a minute.
 */
export function useSetProjectColor(): ReturnType<typeof useSetProjectSetting> {
  const queryClient = useQueryClient();
  return useSetProjectSetting({
    mutation: {
      onSuccess: (_data, variables) => {
        void queryClient.invalidateQueries({
          queryKey: getGetProjectSettingsQueryKey(variables.id),
        });
      },
    },
  });
}
