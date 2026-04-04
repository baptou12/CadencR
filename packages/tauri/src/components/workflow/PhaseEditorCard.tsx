import { useState, useCallback } from "react";
import { ArrowRight, GripVertical, Hand, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useListModels } from "@/api/generated";
import type { WorkflowPhase } from "@/api/generated";
import { cn } from "@/lib/utils";

interface PhaseInfo {
  id: number;
  slug: string;
  name: string;
}

interface PhaseEditorCardProps {
  phase: WorkflowPhase;
  isSelected: boolean;
  isPreset: boolean;
  isDragging: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">>) => void;
  onDelete: () => void;
  allPhaseSlugs: PhaseInfo[];
}

const GATE_OPTIONS: { value: WorkflowPhase["gate_type"]; label: string; icon: React.ReactNode }[] = [
  { value: "auto", label: "Auto", icon: <ArrowRight className="size-3" /> },
  { value: "approval", label: "Approval", icon: <Shield className="size-3 text-amber-500" /> },
  { value: "manual", label: "Manual", icon: <Hand className="size-3 text-blue-500" /> },
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function PhaseEditorCard({
  phase, isSelected, isPreset, isDragging, onSelect, onUpdate, onDelete, allPhaseSlugs,
}: PhaseEditorCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slugManual, setSlugManual] = useState(false);
  const { data: models } = useListModels();

  const handleNameChange = useCallback((value: string) => {
    const updates: Partial<Omit<WorkflowPhase, "id" | "workflow_definition_id">> = { name: value };
    if (!slugManual) updates.slug = slugify(value);
    onUpdate(updates);
  }, [onUpdate, slugManual]);

  const handleSlugChange = useCallback((value: string) => {
    setSlugManual(true);
    onUpdate({ slug: value });
  }, [onUpdate]);

  const handleInputPhaseToggle = useCallback((slug: string) => {
    const current = phase.input_phase_slugs ?? [];
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug];
    onUpdate({ input_phase_slugs: next });
  }, [phase.input_phase_slugs, onUpdate]);

  const handleDelete = useCallback(() => {
    // Check if any other phases depend on this phase
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
      onClick={() => {
        onSelect();
        setExpanded((prev) => !prev);
      }}
    >
      <div className="flex items-center gap-1.5">
        {!isPreset && <GripVertical className="size-3.5 text-muted-foreground shrink-0 cursor-grab" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {GATE_OPTIONS.find((g) => g.value === phase.gate_type)?.icon}
            <span className="truncate font-medium text-xs">{phase.name}</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">{phase.slug}</span>
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

      {/* Expanded editing */}
      {expanded && isSelected && !isPreset && (
        <div className="mt-2 space-y-2 border-t border-border pt-2" onClick={(e) => e.stopPropagation()}>
          <div>
            <label className="text-[10px] text-muted-foreground">Name</label>
            <Input
              value={phase.name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="h-6 text-xs"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Slug</label>
            <Input
              value={phase.slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              className="h-6 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Gate Type</label>
            <Select
              value={phase.gate_type}
              onValueChange={(v) => onUpdate({ gate_type: v as WorkflowPhase["gate_type"] })}
            >
              <SelectTrigger className="h-6 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GATE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="flex items-center gap-1">
                      {opt.icon} {opt.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">Model Override</label>
            <Select
              value={phase.model_override || "__none__"}
              onValueChange={(v) => onUpdate({ model_override: v === "__none__" ? "" : v })}
            >
              <SelectTrigger className="h-6 text-xs">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Default</SelectItem>
                {models?.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {allPhaseSlugs.length > 0 && (
            <div>
              <label className="text-[10px] text-muted-foreground">Input Phases</label>
              <div className="space-y-0.5 mt-0.5">
                {allPhaseSlugs.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={phase.input_phase_slugs?.includes(p.slug) ?? false}
                      onChange={() => handleInputPhaseToggle(p.slug)}
                      className="size-3"
                    />
                    <span>{p.name}</span>
                    <span className="text-muted-foreground font-mono text-[10px]">({p.slug})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {confirmDelete && (
            <p className="text-[10px] text-red-500">Click delete again to confirm</p>
          )}
        </div>
      )}
    </div>
  );
}
