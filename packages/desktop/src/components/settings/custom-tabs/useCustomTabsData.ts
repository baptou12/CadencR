import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import {
  getPluginTabListQueryOptions,
  useListProjects,
  usePluginTabList,
  type PluginTabSummary,
  type Project,
} from "@/api/generated";
import type { ProjectOverride } from "./custom-tab-model";

const NO_TABS: PluginTabSummary[] = [];
const NO_PROJECTS: Project[] = [];
const NO_OVERRIDES: ReadonlyMap<number, ProjectOverride> = new Map();

export interface CustomTabsData {
  tabs: PluginTabSummary[];
  projects: Project[];
  /** Project overrides per tab id: project id → `true`/`false` (unset projects are absent). */
  overridesFor: (tabId: string) => ReadonlyMap<number, ProjectOverride>;
  isLoading: boolean;
  error: Error | null;
}

type ProjectListResult = UseQueryResult<PluginTabSummary[]>;

/** Fold one list per project into tab id → project id → override. */
function combineOverrides(projects: readonly Project[]) {
  return (results: ProjectListResult[]) => {
    const byTab = new Map<string, Map<number, ProjectOverride>>();
    results.forEach((result, index) => {
      const projectId = projects[index]?.id;
      if (projectId === undefined) return;
      for (const tab of result.data ?? NO_TABS) {
        const override = tab.enablement.project;
        if (override === true || override === false) {
          const overrides = byTab.get(tab.id) ?? new Map<number, ProjectOverride>();
          overrides.set(projectId, override);
          byTab.set(tab.id, overrides);
        }
      }
    });
    return byTab;
  };
}

/**
 * Every local custom tab, the projects they can be switched on in, and each
 * project's override.
 *
 * The summary only carries one project's override at a time, so the overrides
 * come from one list request per project (not per tab). All of them share the
 * generated `/api/plugin-tabs` keys, which the `app/plugin_tab_changed` handler
 * and every mutation here invalidate by URL prefix.
 */
export function useCustomTabsData(): CustomTabsData {
  const list = usePluginTabList();
  const projectsQuery = useListProjects();
  const projects = projectsQuery.data ?? NO_PROJECTS;
  const combine = useMemo(() => combineOverrides(projects), [projects]);
  const overrides = useQueries({
    queries: projects.map((project) => getPluginTabListQueryOptions({ project_id: project.id })),
    combine,
  });

  return useMemo(
    () => ({
      tabs: list.data ?? NO_TABS,
      projects,
      overridesFor: (tabId: string) => overrides.get(tabId) ?? NO_OVERRIDES,
      isLoading: list.isLoading,
      error: list.error ?? null,
    }),
    [list.data, list.error, list.isLoading, overrides, projects],
  );
}
