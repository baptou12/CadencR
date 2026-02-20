import { Maximize, RotateCcw, FlaskConical, Wrench } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { PHASE_STATUS_CONFIG } from "@/lib/phase-status";

export interface PhaseData {
  id: number;
  plan_id: number;
  step_number: number;
  title: string;
  status: string;
  complexity: number | null;
  commit_message: string | null;
  prompt: string | null;
  order_index: number;
  implementation_notes: string | null;
  deviations: string | null;
  phase_type: string;
}

interface PhaseCardProps {
  phase: PhaseData;
  displayNumber: number;
  onExpand: (phase: PhaseData) => void;
  canReset?: boolean;
  onReset?: (phase: PhaseData) => void;
}

export function PhaseCard({ phase, displayNumber, onExpand, canReset, onReset }: PhaseCardProps) {
  const config = PHASE_STATUS_CONFIG[phase.status] ?? PHASE_STATUS_CONFIG.pending;
  const StatusIcon = config.icon;

  return (
    <div className="w-72 shrink-0 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon className={cn("size-4 shrink-0", config.className)} />
          <span className="text-xs font-medium text-muted-foreground">
            Phase {displayNumber}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
              config.badgeClassName,
            )}
          >
            {config.label}
          </span>
          {phase.phase_type === 'qa' && (
            <span className="flex items-center gap-0.5 rounded-full bg-[var(--drac-purple)]/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--drac-purple)]">
              <FlaskConical className="size-2.5" />
              QA
            </span>
          )}
          {phase.phase_type === 'setup' && (
            <span className="flex items-center gap-0.5 rounded-full bg-[var(--drac-cyan)]/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--drac-cyan)]">
              <Wrench className="size-2.5" />
              Setup
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {canReset && onReset && (
            <button
              onClick={(e) => { e.stopPropagation(); onReset(phase); }}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-[var(--drac-orange)]"
              title="Reset phase to pending"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
          <button
            onClick={() => onExpand(phase)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Expand phase"
          >
            <Maximize className="size-3.5" />
          </button>
        </div>
      </div>

      <h4 className="mt-1.5 text-sm font-semibold leading-snug truncate" title={phase.title}>
        {phase.title}
      </h4>

      {phase.prompt && (
        <div className="mt-2 max-h-32 overflow-hidden relative">
          <Markdown content={phase.prompt} className="text-xs" />
          <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-card to-transparent" />
        </div>
      )}
    </div>
  );
}
