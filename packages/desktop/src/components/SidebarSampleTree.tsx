import { useMemo, useState, type ReactElement } from "react";
import { ArchivedFeatureSection } from "@/components/ArchivedFeatureList";
import { FeatureSubtree, type RenderFeature } from "@/components/FeatureSubtree";
import { ProjectRowLabel } from "@/components/ProjectRowButton";
import { ProjectRowAttention } from "@/components/SidebarAttentionProvider";
import { SidebarSampleRow } from "@/components/SidebarSampleRow";
import { useSamplePreview } from "@/components/SidebarSampleProvider";
import { splitDormant } from "@/hooks/useDormantSplit";
import { buildFeatureForest, type FeatureTreeNode } from "@/lib/feature-hierarchy";
import { outranks } from "@/lib/sidebar-attention";
import { SAMPLE_PROJECTS, type SampleProject } from "@/lib/sidebar-sample-data";
import type { SampleRow } from "@/lib/sidebar-sample-views";
import { DAY_MS } from "@/lib/sidebar-time";
import { useSidebarOption } from "@/stores/sidebar-config-store";

type Preview = ReturnType<typeof useSamplePreview>;

/** The project list, filled with sample projects: folded ones show their badges. */
export function SidebarSampleTree(): ReactElement {
  const preview = useSamplePreview();
  return (
    <>
      {SAMPLE_PROJECTS.map((project) => (
        <SampleProjectRow key={project.id} project={project} preview={preview} />
      ))}
    </>
  );
}

function SampleProjectRow({
  project,
  preview,
}: {
  project: SampleProject;
  preview: Preview;
}): ReactElement {
  const expanded = preview.expandedProjects.has(project.id);
  const rows = useMemo(
    () => preview.rows.filter((row) => row.conversation.feature.project_id === project.id),
    [preview.rows, project.id],
  );
  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => preview.setProjectExpanded(project.id, !expanded)}
        className="sidebar-project-row relative flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
      >
        <ProjectRowLabel projectId={project.id} name={project.name} expanded={expanded} />
        {!expanded && <ProjectRowAttention projectId={project.id} />}
      </button>
      {expanded && <SampleConversations rows={rows} preview={preview} />}
    </div>
  );
}

/** A project's conversations as the tree lays them out: nested, pinned ones left out, idle ones folded. */
function SampleConversations({
  rows,
  preview,
}: {
  rows: readonly SampleRow[];
  preview: Preview;
}): ReactElement {
  const after = useSidebarOption("dormantAfter");
  const [showDormant, setShowDormant] = useState(false);
  const { activeFeatureId, now } = preview;
  const byId = useMemo(
    () => new Map(rows.map((row) => [row.conversation.feature.id, row])),
    [rows],
  );
  const { awake, dormant } = useMemo(() => {
    const forest = buildFeatureForest(
      rows
        .map((row) => row.conversation.feature)
        .filter((feature) => !feature.is_pinned)
        .sort((a, b) => (b.last_activity_at ?? "").localeCompare(a.last_activity_at ?? "")),
    );
    const none = { awake: forest, dormant: [] as FeatureTreeNode[] };
    if (after === "never") return none;
    const keepAwake = (featureId: number) =>
      featureId === activeFeatureId || byId.get(featureId)?.state !== "idle";
    return splitDormant(forest, now - Number(after) * DAY_MS, keepAwake) ?? none;
  }, [activeFeatureId, after, byId, now, rows]);

  const renderFeature: RenderFeature = (feature, control, depth, hiddenIds) => {
    const row = byId.get(feature.id);
    if (!row) return null;
    return (
      <SidebarSampleRow
        row={row}
        variant="tree"
        depth={depth}
        hierarchyControl={control}
        foldedSource={hiddenIds && mostUrgent(row, hiddenIds, byId)}
        isActive={feature.id === activeFeatureId}
        onSelect={preview.select}
      />
    );
  };
  const renderSubtree = (node: FeatureTreeNode) => (
    <FeatureSubtree
      key={node.feature.id}
      node={node}
      renderFeature={renderFeature}
      collapsedIds={preview.collapsedParents}
      onSetCollapsed={preview.setParentCollapsed}
    />
  );
  return (
    <div className="flex flex-col gap-0.5">
      {awake.map(renderSubtree)}
      <ArchivedFeatureSection
        label="Dormant"
        features={dormant.map((node) => node.feature)}
        expanded={showDormant}
        onToggle={() => setShowDormant((open) => !open)}
      >
        {dormant.map(renderSubtree)}
      </ArchivedFeatureSection>
    </div>
  );
}

function mostUrgent(
  row: SampleRow,
  hiddenIds: readonly number[],
  byId: ReadonlyMap<number, SampleRow>,
): SampleRow {
  let best = row;
  for (const id of hiddenIds) {
    const hidden = byId.get(id);
    if (hidden && outranks(hidden.state, best.state)) best = hidden;
  }
  return best;
}
