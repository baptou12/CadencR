import { RotateCcw, FlaskConical, Wrench } from "lucide-react";
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
    <div
      className="flex flex-col gap-0.5 rounded-lg px-3 py-2 cursor-pointer hover:bg-muted min-w-0"
      onClick={() => onExpand(phase)}
    >
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <StatusIcon className={cn("size-4 shrink-0", config.className)} />
        <span className="text-xs font-medium text-muted-foreground shrink-0">
          Phase {displayNumber}
        </span>
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0",
            config.badgeClassName,
          )}
        >
          {config.label}
        </span>
        {phase.phase_type === 'qa' && (
          <span className="flex items-center gap-0.5 rounded-full bg-[var(--drac-purple)]/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--drac-purple)] shrink-0">
            <FlaskConical className="size-2.5" />
            QA
          </span>
        )}
        {phase.phase_type === 'setup' && (
          <span className="flex items-center gap-0.5 rounded-full bg-[var(--drac-cyan)]/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--drac-cyan)] shrink-0">
            <Wrench className="size-2.5" />
            Setup
          </span>
        )}
        {phase.complexity != null && (
          <span className="rounded-full bg-[var(--drac-red)]/20 px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--drac-red)] shrink-0">
            {phase.complexity}
          </span>
        )}
        {canReset && onReset && (
          <button
            onClick={(e) => { e.stopPropagation(); onReset(phase); }}
            className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-[var(--drac-orange)] shrink-0 ml-auto"
            title="Reset phase to pending"
          >
            <RotateCcw className="size-3" />
          </button>
        )}
      </div>
      <p className="text-sm font-medium leading-snug pl-6 break-words" title={phase.title}>
        {phase.title}
      </p>
    </div>
  );
}
