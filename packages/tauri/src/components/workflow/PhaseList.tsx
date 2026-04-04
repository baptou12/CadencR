import { useCallback, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowPhase } from "@/api/generated";
import { PhaseEditorCard } from "./PhaseEditorCard";
import { PhaseDependencyBadges } from "./PhaseDependencyBadges";

interface PhaseListProps {
  phases: WorkflowPhase[];
  selectedPhaseId: number | null;
  isPreset: boolean;
  onSelect: (id: number) => void;
  onDelete: (id: number) => Promise<void>;
  onReorder: (phaseIds: number[]) => Promise<void>;
  onAdd: () => Promise<void>;
}

export function PhaseList({
  phases, selectedPhaseId, isPreset, onSelect, onDelete, onReorder, onAdd,
}: PhaseListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [hoveredPhaseId, setHoveredPhaseId] = useState<number | null>(null);
  const dragIdRef = useRef<number | null>(null);

  // Build slug→phase lookup and dependency sets for highlighting
  const { slugToPhase, relatedIds } = useMemo(() => {
    const lookup = new Map<string, WorkflowPhase>();
    for (const p of phases) lookup.set(p.slug, p);

    const related = new Set<number>();
    if (hoveredPhaseId != null) {
      const hovered = phases.find((p) => p.id === hoveredPhaseId);
      if (hovered) {
        related.add(hovered.id);
        // Upstream: phases this one depends on
        for (const slug of hovered.input_phase_slugs ?? []) {
          const up = lookup.get(slug);
          if (up) related.add(up.id);
        }
        // Downstream: phases that depend on this one
        for (const p of phases) {
          if (p.input_phase_slugs?.includes(hovered.slug)) related.add(p.id);
        }
      }
    }
    return { slugToPhase: lookup, relatedIds: related };
  }, [phases, hoveredPhaseId]);

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    dragIdRef.current = phases[idx].id;
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    // Required for Firefox
    e.dataTransfer.setData("text/plain", String(idx));
  }, [phases]);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOverIdx(idx);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    setDragIdx(null);
    setOverIdx(null);
    if (dragIdRef.current == null) return;

    const fromIdx = phases.findIndex((p) => p.id === dragIdRef.current);
    if (fromIdx === -1 || fromIdx === dropIdx) return;

    const newOrder = phases.map((p) => p.id);
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    void onReorder(newOrder);
  }, [phases, onReorder]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
    dragIdRef.current = null;
  }, []);

  return (
    <div className="p-2 space-y-1">
      <div className="text-xs font-medium text-muted-foreground px-2 py-1">
        Phases ({phases.length})
      </div>
      {phases.map((phase, idx) => {
        const isDimmed = hoveredPhaseId != null && !relatedIds.has(phase.id);
        // Resolve input phase names for badges
        const inputPhases = (phase.input_phase_slugs ?? [])
          .map((slug) => slugToPhase.get(slug))
          .filter((p): p is WorkflowPhase => p != null);

        return (
          <div
            key={phase.id}
            draggable={!isPreset}
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
            onMouseEnter={() => setHoveredPhaseId(phase.id)}
            onMouseLeave={() => setHoveredPhaseId(null)}
            className={`transition-opacity ${isDimmed ? "opacity-40" : ""} ${
              dragIdx !== null && overIdx === idx && dragIdx !== idx
                ? "border-t-2 border-purple-500"
                : ""
            }`}
          >
            <PhaseEditorCard
              phase={phase}
              isSelected={phase.id === selectedPhaseId}
              isPreset={isPreset}
              isDragging={dragIdx === idx}
              onSelect={() => onSelect(phase.id)}
              onDelete={() => onDelete(phase.id)}
            />
            {inputPhases.length > 0 && (
              <PhaseDependencyBadges
                inputPhases={inputPhases}
                onClickPhase={onSelect}
              />
            )}
          </div>
        );
      })}
      {!isPreset && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs text-muted-foreground"
          onClick={() => void onAdd()}
        >
          <Plus className="size-3 mr-1" />
          Add Phase
        </Button>
      )}
    </div>
  );
}
