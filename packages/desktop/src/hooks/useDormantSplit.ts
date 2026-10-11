import { useMemo, useRef } from "react";
import { useSidebarAttention } from "@/components/SidebarAttentionProvider";
import { useHourClock } from "@/hooks/useMinuteClock";
import { parseUTCDateTime } from "@/lib/date-utils";
import type { FeatureTreeNode } from "@/lib/feature-hierarchy";
import { DAY_MS } from "@/lib/sidebar-time";
import { useSidebarOption } from "@/stores/sidebar-config-store";

const NO_NODES: FeatureTreeNode[] = [];

interface DormantSplit {
  awake: FeatureTreeNode[];
  dormant: FeatureTreeNode[];
}

function lastActivityMs(node: FeatureTreeNode): number {
  const iso = node.feature.last_activity_at ?? node.feature.created_at;
  const time = iso ? parseUTCDateTime(iso).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** Whether a conversation and everything spawned under it went quiet before `cutoff`. */
function isDormant(
  node: FeatureTreeNode,
  cutoff: number,
  keepAwake: (featureId: number) => boolean,
): boolean {
  if (keepAwake(node.feature.id) || lastActivityMs(node) >= cutoff) return false;
  return node.children.every((child) => isDormant(child, cutoff, keepAwake));
}

function sameNodes(a: readonly FeatureTreeNode[], b: readonly FeatureTreeNode[]): boolean {
  return a.length === b.length && a.every((node, index) => node === b[index]);
}

/**
 * Splits a project's top-level conversations into the ones shown and the ones
 * folded into "Dormant (N)" (G9): idle for longer than the configured days,
 * subtree included. The open conversation and any that is working, waiting,
 * failed or unread always stay out; nothing is folded while filtering. Purely
 * visual: no data changes. Pinned conversations never reach this list. Keeps
 * its previous result while the split is unchanged, so the rows below don't
 * re-render for nothing.
 */
export function useDormantSplit(
  forest: FeatureTreeNode[],
  activeFeatureId: number | null,
  isFiltering: boolean,
): DormantSplit {
  const after = useSidebarOption("dormantAfter");
  const enabled = after !== "never" && !isFiltering;
  const { entries } = useSidebarAttention();
  const now = useHourClock(enabled);
  const previous = useRef<DormantSplit>({ awake: forest, dormant: NO_NODES });
  return useMemo(() => {
    let next: DormantSplit = { awake: forest, dormant: NO_NODES };
    if (enabled) {
      const cutoff = now - Number(after) * DAY_MS;
      const needsLook = new Set(entries.map((entry) => entry.featureId));
      const keepAwake = (featureId: number) =>
        featureId === activeFeatureId || needsLook.has(featureId);
      const awake: FeatureTreeNode[] = [];
      const dormant: FeatureTreeNode[] = [];
      for (const node of forest) (isDormant(node, cutoff, keepAwake) ? dormant : awake).push(node);
      if (dormant.length > 0) next = { awake, dormant };
    }
    const prior = previous.current;
    if (sameNodes(prior.awake, next.awake) && sameNodes(prior.dormant, next.dormant)) return prior;
    previous.current = next;
    return next;
  }, [activeFeatureId, after, enabled, entries, forest, now]);
}
