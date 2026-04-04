import { ArrowRight, Hand, Shield } from "lucide-react";
import type { WorkflowPhase } from "@/api/generated";
import { cn } from "@/lib/utils";

interface WorkflowPhasePreviewProps {
  phases: WorkflowPhase[];
  className?: string;
}

const gateIcons: Record<WorkflowPhase["gate_type"], React.ReactNode> = {
  auto: <ArrowRight className="size-3 text-muted-foreground" />,
  approval: <Shield className="size-3 text-amber-500" />,
  manual: <Hand className="size-3 text-blue-500" />,
};

export function WorkflowPhasePreview({ phases, className }: WorkflowPhasePreviewProps) {
  const sorted = [...phases].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto", className)}>
      {sorted.map((phase, i) => (
        <div key={phase.id} className="flex items-center gap-1 shrink-0">
          {i > 0 && <span className="text-muted-foreground/50">›</span>}
          <div className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {gateIcons[phase.gate_type]}
            <span className="truncate max-w-[80px]">{phase.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
