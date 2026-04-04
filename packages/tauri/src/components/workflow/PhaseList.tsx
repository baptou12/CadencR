import { useCallback, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowPhase } from "@/api/generated";
import { PhaseEditorCard } from "./PhaseEditorCard";

interface PhaseInfo {
  id: number;
  slug: string;
  name: string;
}

interface PhaseListProps {
  phases: WorkflowPhase[];
  selectedPhaseId: number | null;
  isPreset: boolean;
  onSelect: (id: number) => void;
  onUpdate: (id: number, updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onReorder: (phaseIds: number[]) => Promise<void>;
  onAdd: () => Promise<void>;
  allPhaseSlugs: PhaseInfo[];
}

export function PhaseList({
  phases, selectedPhaseId, isPreset, onSelect, onUpdate, onDelete, onReorder, onAdd, allPhaseSlugs,
}: PhaseListProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragIdRef = useRef<number | null>(null);

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
      {phases.map((phase, idx) => (
        <div
          key={phase.id}
          draggable={!isPreset}
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={
            dragIdx !== null && overIdx === idx && dragIdx !== idx
              ? "border-t-2 border-purple-500"
              : ""
          }
        >
          <PhaseEditorCard
            phase={phase}
            isSelected={phase.id === selectedPhaseId}
            isPreset={isPreset}
            isDragging={dragIdx === idx}
            onSelect={() => onSelect(phase.id)}
            onUpdate={(updates) => onUpdate(phase.id, updates)}
            onDelete={() => onDelete(phase.id)}
            allPhaseSlugs={allPhaseSlugs.filter((p) => p.id !== phase.id)}
          />
        </div>
      ))}
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
