import type { ReactElement } from "react";
import { HistoryIcon, InboxIcon, LoaderIcon, PinIcon, type LucideIcon } from "lucide-react";
import { SidebarBlock } from "@/components/SidebarBlock";
import { SidebarSampleRow } from "@/components/SidebarSampleRow";
import { useSamplePreview } from "@/components/SidebarSampleProvider";
import { isStrongAttention } from "@/lib/sidebar-attention";
import type { SampleRow } from "@/lib/sidebar-sample-views";
import { useSidebarOption } from "@/stores/sidebar-config-store";
import {
  SidebarSurfaceContext,
  useSidebarBlockFold,
  type SidebarBlockId,
} from "@/stores/sidebar-surface-store";

/** The blocks above the projects (For me, In progress, Recent, Pinned), filled with samples. */
export function SidebarSampleBlocks(): ReactElement {
  const { views } = useSamplePreview();
  const forMeOn = useSidebarOption("forMe");
  const workingOn = useSidebarOption("workingBlock");
  const recentOn = useSidebarOption("recentBlock");
  return (
    <>
      {forMeOn && (
        <SampleBlock
          label="For me"
          icon={InboxIcon}
          block="for-me"
          rows={views.forMe}
          empty="Nothing waiting on you"
          strongCount={views.forMe.filter((row) => isStrongAttention(row.state)).length}
        />
      )}
      {workingOn && (
        <SampleBlock
          label="In progress"
          icon={LoaderIcon}
          block="working"
          rows={views.working}
          empty="No agent at work"
        />
      )}
      {recentOn && (
        <SampleBlock
          label="Recent"
          icon={HistoryIcon}
          block="recent"
          rows={views.recent}
          empty="No conversation yet"
          showCount={false}
        />
      )}
      <SampleBlock
        label="Pinned"
        icon={PinIcon}
        block="pinned"
        rows={views.pinned}
        empty="Pin a conversation to keep it here"
        strongCount={views.pinned.filter((row) => isStrongAttention(row.state)).length}
      />
    </>
  );
}

interface SampleBlockProps {
  label: string;
  block: SidebarBlockId;
  icon: LucideIcon;
  rows: readonly SampleRow[];
  empty: string;
  showCount?: boolean;
  strongCount?: number;
}

function SampleBlock({
  label,
  icon,
  block,
  rows,
  empty,
  showCount = true,
  strongCount,
}: SampleBlockProps): ReactElement | null {
  const preview = useSamplePreview();
  // Folds with the live block of the same name: the preview is the user's sidebar.
  const fold = useSidebarBlockFold(block);
  const hideEmpty = useSidebarOption("hideEmptyBlocks");
  if (rows.length === 0 && hideEmpty) return null;
  return (
    <SidebarBlock
      block={block}
      label={label}
      icon={icon}
      count={showCount ? rows.length : undefined}
      strongCount={strongCount}
      fold={fold}
      empty={empty}
      isEmpty={rows.length === 0}
      capped
    >
      {/* Pinned rows belong to the tree's surface. */}
      <SidebarSurfaceContext.Provider value={block === "pinned" ? "tree" : block}>
        {rows.map((row) => (
          <SidebarSampleRow
            key={row.conversation.feature.id}
            row={row}
            variant="block"
            isActive={row.conversation.feature.id === preview.activeFeatureId}
            onSelect={preview.select}
          />
        ))}
      </SidebarSurfaceContext.Provider>
    </SidebarBlock>
  );
}
