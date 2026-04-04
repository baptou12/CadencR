import { useState, useCallback } from "react";
import { ArrowRight, GripVertical, Hand, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowPhase } from "@/api/generated";
import { cn } from "@/lib/utils";

export const GATE_OPTIONS: { value: WorkflowPhase["gate_type"]; label: string; icon: React.ReactNode }[] = [
  { value: "auto", label: "Auto", icon: <ArrowRight className="size-3" /> },
  { value: "approval", label: "Approval", icon: <Shield className="size-3 text-amber-500" /> },
  { value: "manual", label: "Manual", icon: <Hand className="size-3 text-blue-500" /> },
];

interface PhaseEditorCardProps {
  phase: WorkflowPhase;
  isSelected: boolean;
  isPreset: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function PhaseEditorCard({
  phase, isSelected, isPreset, isDragging, onSelect, onDelete,
}: PhaseEditorCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = useCallback(() => {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }, [confirmDelete, onDelete]);

  return (
    <div
      className={cn(
        "rounded-md border p-2 text-sm cursor-pointer transition-colors",
        isSelected ? "border-purple-500 bg-purple-500/10" : "border-border hover:border-muted-foreground/30",
        isDragging && "opacity-50",
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5">
        {!isPreset && <GripVertical className="size-3.5 text-muted-foreground shrink-0 cursor-grab" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {GATE_OPTIONS.find((g) => g.value === phase.gate_type)?.icon}
            <span className="truncate font-medium text-xs">{phase.name}</span>
          </div>
        </div>
        {!isPreset && (
          <Button
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete();
            }}
          >
            <Trash2 className={cn("size-3", confirmDelete ? "text-red-500" : "text-muted-foreground")} />
          </Button>
        )}
      </div>
      {confirmDelete && (
        <p className="text-[10px] text-red-500 mt-1">Click delete again to confirm</p>
      )}
    </div>
  );
}
