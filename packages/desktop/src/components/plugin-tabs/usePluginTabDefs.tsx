import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { usePluginTabList, type PluginTabSummary } from "@/api/generated";
import type { FeatureTabDef } from "@/components/feature-layout/types";
import { rememberFeatureProject } from "@/lib/plugin-tabs/feature-projects";
import { pluginTabInstanceId } from "@/lib/plugin-tabs/instance-id";
import { clearInstanceState, usePluginTabRuntimeStore } from "@/lib/plugin-tabs/runtime-store";
import {
  pluginIdOfTab,
  pluginTabKind,
  type PluginTabKind,
  type TabKind,
} from "@/stores/feature-layout-schema";
import { selectFeatureLayout, useFeatureLayoutStore } from "@/stores/feature-layout-store";
import { getPluginTabs } from "@/stores/feature-layout-tree";

import { PluginTabAccessMark } from "./PluginTabAccess";
import { PluginTabIcon } from "./PluginTabIcon";
import { PluginTabView } from "./PluginTabView";
import { usePluginTabContext, type PluginTabContextData } from "./usePluginTabContext";

export type PluginTabDefs = Partial<Record<PluginTabKind, FeatureTabDef>>;

const NO_DEFS: PluginTabDefs = {};
/** Separates instance id and text in the badge selector's primitive key. */
const BADGE_SEPARATOR = "\u0000";

/**
 * The project's local custom tabs (shared query with the "+" menu). Never
 * stale on its own: `app/plugin_tab_changed` and every enablement write
 * invalidate it.
 */
export function useProjectPluginTabs(projectId: number, enabled: boolean) {
  return usePluginTabList(
    { project_id: projectId },
    { query: { enabled, staleTime: Number.POSITIVE_INFINITY } },
  );
}

/**
 * Plugin tabs placed in the feature's layout, joined into a string so the
 * selector result is a primitive (a fresh array per store update would
 * re-render every feature page on every layout write).
 */
export function usePlacedPluginTabsKey(featureId: number, enabled: boolean): string {
  return useFeatureLayoutStore((state) =>
    enabled ? getPluginTabs(selectFeatureLayout(featureId)(state).splitRoot).join("|") : "",
  );
}

/**
 * This feature's badges as one primitive (`instanceId \0 text` pairs): a
 * badge written by another feature's tab doesn't re-render this page.
 */
function useFeatureBadgesKey(featureId: number): string {
  const prefix = pluginTabInstanceId(featureId, "");
  return usePluginTabRuntimeStore((state) =>
    Object.entries(state.badges)
      .filter(([instanceId]) => instanceId.startsWith(prefix))
      .flat()
      .join(BADGE_SEPARATOR),
  );
}

function badgesOf(key: string): Map<string, string> {
  const parts = key === "" ? [] : key.split(BADGE_SEPARATOR);
  const badges = new Map<string, string>();
  for (let index = 0; index + 1 < parts.length; index += 2) {
    badges.set(parts[index]!, parts[index + 1]!);
  }
  return badges;
}

/**
 * A custom tab closed in this feature forgets its `state.*` (it otherwise
 * outlives guests and brokers on purpose). A move between panes keeps the
 * tab placed, so it keeps its state.
 */
function useForgetClosedTabState(featureId: number, placedKey: string): void {
  const previous = useRef({ featureId, placedKey });
  useEffect(() => {
    const before = previous.current;
    previous.current = { featureId, placedKey };
    if (before.featureId !== featureId || before.placedKey === "") return;
    const placed = new Set(placedKey.split("|"));
    for (const tab of before.placedKey.split("|") as TabKind[]) {
      const pluginId = pluginIdOfTab(tab);
      if (pluginId && !placed.has(tab))
        clearInstanceState(pluginTabInstanceId(featureId, pluginId));
    }
  }, [featureId, placedKey]);
}

function PluginTabBadge({ text }: { text: string }) {
  return <span className="font-mono text-[11px] tabular-nums text-primary">{text}</span>;
}

/** The tab's own badge, after the mark of a tab that runs commands or native code. */
function triggerBadge(summary: PluginTabSummary, text: string | undefined): ReactNode {
  const level = summary.access_level;
  if (level === "ui") return text ? <PluginTabBadge text={text} /> : undefined;
  return (
    <span className="inline-flex items-center gap-1">
      <PluginTabAccessMark level={level} />
      {text ? <PluginTabBadge text={text} /> : null}
    </span>
  );
}

/**
 * Tab definitions for every custom tab placed in this feature's layout whose
 * plugin the project lists — valid or not, on or off: the tab body explains
 * an invalid or disabled tab, so the user can understand it and close it. A
 * placed tab whose plugin is gone has no definition and stays hidden (its
 * placement survives in the layout). Nothing is fetched or derived for a
 * feature with no custom tab placed (the "+" menu lists on its own).
 */
export function usePluginTabDefs({
  featureId,
  projectId,
  contextData,
  enabled,
}: {
  featureId: number;
  projectId: number;
  contextData: PluginTabContextData;
  enabled: boolean;
}): PluginTabDefs {
  const placedKey = usePlacedPluginTabsKey(featureId, enabled);
  const anyPlaced = placedKey !== "";
  useForgetClosedTabState(featureId, placedKey);
  // The presence keeper needs it to tell whether these tabs may run while
  // this conversation is off screen.
  useEffect(() => {
    if (anyPlaced) rememberFeatureProject(featureId, projectId);
  }, [anyPlaced, featureId, projectId]);
  const context = usePluginTabContext(featureId, projectId, contextData, anyPlaced);
  const summaries = useProjectPluginTabs(projectId, anyPlaced).data;
  const badgesKey = useFeatureBadgesKey(featureId);
  return useMemo(() => {
    if (!anyPlaced || !summaries) return NO_DEFS;
    const badges = badgesOf(badgesKey);
    const defs: PluginTabDefs = {};
    for (const tab of placedKey.split("|") as TabKind[]) {
      const pluginId = pluginIdOfTab(tab);
      const summary = summaries.find((candidate) => candidate.id === pluginId);
      if (!pluginId || !summary) continue;
      const badge = badges.get(pluginTabInstanceId(featureId, pluginId));
      defs[pluginTabKind(pluginId)] = {
        label: summary.label,
        iconNode: <PluginTabIcon svg={summary.icon_svg} />,
        closable: true,
        badge: triggerBadge(summary, badge),
        content: <PluginTabView featureId={featureId} summary={summary} context={context} />,
      };
    }
    return defs;
  }, [anyPlaced, badgesKey, context, featureId, placedKey, summaries]);
}
