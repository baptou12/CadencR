import { CircleIcon, Loader2, CheckCircle2, XCircle, Maximize } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";

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
}

interface PhaseCardProps {
  phase: PhaseData;
  onExpand: (phase: PhaseData) => void;
}

const statusConfig: Record<string, { icon: React.ElementType; className: string; label: string }> = {
  pending: { icon: CircleIcon, className: "text-muted-foreground", label: "Pending" },
  running: { icon: Loader2, className: "text-[var(--drac-orange)] animate-spin", label: "Running" },
  completed: { icon: CheckCircle2, className: "text-[var(--drac-green)]", label: "Completed" },
  done: { icon: CheckCircle2, className: "text-[var(--drac-green)]", label: "Done" },
  error: { icon: XCircle, className: "text-[var(--drac-red)]", label: "Error" },
};

export function PhaseCard({ phase, onExpand }: PhaseCardProps) {
  const config = statusConfig[phase.status] ?? statusConfig.pending;
  const StatusIcon = config.icon;

  return (
    <div className="w-72 shrink-0 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon className={cn("size-4 shrink-0", config.className)} />
          <span className="text-xs font-medium text-muted-foreground">
            Phase {phase.step_number}
          </span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
              config.className,
              "bg-muted",
            )}
          >
            {config.label}
          </span>
        </div>
        <button
          onClick={() => onExpand(phase)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Expand phase"
        >
          <Maximize className="size-3.5" />
        </button>
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
