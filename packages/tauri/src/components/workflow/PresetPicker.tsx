import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useListWorkflowDefinitions, type WorkflowDefinition } from "@/api/generated";
import { WorkflowPhasePreview } from "./WorkflowPhasePreview";

interface PresetPickerProps {
  onSelect: (definitionId: number | null) => void;
  selectedId: number | null;
}

const PRESET_ORDER = ["cadence-default", "speckit", "bmad", "openspec"];

function sortDefinitions(defs: WorkflowDefinition[]): WorkflowDefinition[] {
  const presets = defs.filter((d) => d.is_preset);
  const custom = defs.filter((d) => !d.is_preset);

  presets.sort(
    (a, b) => (PRESET_ORDER.indexOf(a.slug) ?? 99) - (PRESET_ORDER.indexOf(b.slug) ?? 99),
  );
  custom.sort((a, b) => a.name.localeCompare(b.name));

  return [...presets, ...custom];
}

function DefinitionCard({
  definition,
  selected,
  onSelect,
}: {
  definition: WorkflowDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
        selected ? "border-primary bg-accent/30" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">{definition.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {definition.is_preset && <Badge variant="secondary">Preset</Badge>}
          <Badge variant="outline">{definition.phases.length} phases</Badge>
        </div>
      </div>
      {definition.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">{definition.description}</p>
      )}
      <WorkflowPhasePreview phases={definition.phases} className="mt-auto" />
    </button>
  );
}

function LegacyCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
        selected ? "border-primary bg-accent/30" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Classic (Plan → PRD → Build)</span>
        <Badge variant="secondary">Built-in</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        The original three-phase workflow with plan, PRD, and build stages.
      </p>
    </button>
  );
}

function CustomCard() {
  return (
    <button
      type="button"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
    >
      <Plus className="size-5" />
      <span className="text-sm font-medium">Custom Workflow</span>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-5 w-48 mt-auto" />
    </div>
  );
}

export function PresetPicker({ onSelect, selectedId }: PresetPickerProps) {
  const { data: definitions, isLoading } = useListWorkflowDefinitions();
  const sorted = useMemo(() => sortDefinitions(definitions ?? []), [definitions]);

  return (
    <div className="grid grid-cols-2 gap-3">
      <LegacyCard selected={selectedId === null} onSelect={() => onSelect(null)} />
      {isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : (
        sorted.map((def) => (
          <DefinitionCard
            key={def.id}
            definition={def}
            selected={selectedId === def.id}
            onSelect={() => onSelect(def.id)}
          />
        ))
      )}
      <CustomCard />
    </div>
  );
}
