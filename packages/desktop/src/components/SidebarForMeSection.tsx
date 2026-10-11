import type { ReactElement } from "react";
import { ChevronDown, ChevronRight, InboxIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { PinnedConversationRow } from "@/components/PinnedConversationRow";
import { useSidebarAttention } from "@/components/SidebarAttentionProvider";
import { useCrossProjectNavigate } from "@/hooks/useCrossProjectNavigate";
import { isStrongAttention } from "@/lib/sidebar-attention";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import { useSidebarFilterQuery } from "@/stores/sidebar-filter-store";
import { SidebarSurfaceContext, useSidebarSurfaceStore } from "@/stores/sidebar-surface-store";

/**
 * "For me" (F2): every conversation waiting on the user, failed or unread,
 * across all projects, as one queue. Pending requests come first, then
 * failures, then unread replies; each group oldest first (E10), and a failure
 * leaves once opened. Agents at work stay out: nothing to do there yet.
 * Renders nothing when the queue is empty or while the sidebar filter is on.
 */
export function SidebarForMeSection({
  activeFeatureId,
  onSelectFeature,
}: {
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}): ReactElement | null {
  const enabled = useSidebarOption("forMe");
  const filtering = useSidebarFilterQuery() !== "";
  const { queue, isQueueLoading } = useSidebarAttention();
  const expanded = useSidebarSurfaceStore((state) => state.forMeExpanded);
  const toggle = useSidebarSurfaceStore((state) => state.toggleForMe);
  const handleNavigate = useCrossProjectNavigate(activeFeatureId, onSelectFeature);
  const visible = enabled && !filtering && (queue.length > 0 || isQueueLoading);

  if (!visible) return null;
  const strong = queue.filter((item) => isStrongAttention(item.state)).length;
  return (
    <section aria-label="For me" className="mb-2 flex shrink-0 flex-col gap-0.5 px-1">
      <button
        type="button"
        data-nav-item
        aria-expanded={expanded}
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-md px-2 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
      >
        <InboxIcon className="size-3 shrink-0" />
        <span>For me</span>
        <span className="font-semibold tabular-nums tracking-normal">
          {queue.length}
          {strong > 0 && <span className="sr-only">{`, ${strong} need an action`}</span>}
        </span>
        {expanded ? (
          <ChevronDown className="ml-auto size-3 shrink-0" />
        ) : (
          <ChevronRight className="ml-auto size-3 shrink-0" />
        )}
      </button>
      {expanded && queue.length === 0 && (
        <Skeleton aria-label="Loading conversations needing you" className="mx-2 my-1 h-5" />
      )}
      {expanded && (
        // Capped so a long queue scrolls on its own instead of pushing the projects away.
        <div className="flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto">
          <SidebarSurfaceContext.Provider value="for-me">
            {queue.map(({ feature }) => (
              <PinnedConversationRow
                key={feature.id}
                feature={feature}
                activeFeatureId={activeFeatureId}
                onNavigate={handleNavigate}
              />
            ))}
          </SidebarSurfaceContext.Provider>
        </div>
      )}
    </section>
  );
}
