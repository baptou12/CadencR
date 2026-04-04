import {
  ArrowRight,
  Hand,
  Shield,
  Hammer,
  Play,
  FileText,
  ShieldAlert,
  SearchCheck,
  MessageSquare,
  FlaskConical,
  ClipboardList,
} from "lucide-react";
import type { WorkflowPhase } from "@/api/generated";
import { cn } from "@/lib/utils";

interface WorkflowPhasePreviewProps {
  phases: WorkflowPhase[];
  className?: string;
}

type PhaseIconDef = { icon: React.ElementType; className: string };

// Keyword → icon mapping, checked against lowercased phase name
const PHASE_NAME_ICONS: Array<{ keywords: string[]; def: PhaseIconDef }> = [
  { keywords: ["build", "apply", "implement", "implementation", "execute"], def: { icon: Hammer, className: "size-3 text-emerald-500" } },
  { keywords: ["plan", "planning"], def: { icon: Play, className: "size-3 text-blue-400" } },
  { keywords: ["prd", "spec", "specify", "constitution"], def: { icon: FileText, className: "size-3 text-violet-400" } },
  { keywords: ["review", "analyze", "analysis", "retro"], def: { icon: SearchCheck, className: "size-3 text-sky-400" } },
  { keywords: ["risk"], def: { icon: ShieldAlert, className: "size-3 text-amber-500" } },
  { keywords: ["session"], def: { icon: MessageSquare, className: "size-3 text-foreground/50" } },
  { keywords: ["qa", "test"], def: { icon: FlaskConical, className: "size-3 text-pink-400" } },
  { keywords: ["task", "tasks"], def: { icon: ClipboardList, className: "size-3 text-orange-400" } },
  { keywords: ["propose", "archive", "solution", "solutioning"], def: { icon: FileText, className: "size-3 text-violet-400" } },
];

const GATE_ICONS: Record<WorkflowPhase["gate_type"], PhaseIconDef> = {
  auto: { icon: ArrowRight, className: "size-3 text-foreground/50" },
  approval: { icon: Shield, className: "size-3 text-amber-500" },
  manual: { icon: Hand, className: "size-3 text-blue-500" },
};

function resolvePhaseIcon(phase: WorkflowPhase): PhaseIconDef {
  const lower = phase.name.toLowerCase();
  for (const { keywords, def } of PHASE_NAME_ICONS) {
    if (keywords.some((kw) => lower.includes(kw))) return def;
  }
  return GATE_ICONS[phase.gate_type];
}

export function WorkflowPhasePreview({ phases, className }: WorkflowPhasePreviewProps) {
  const sorted = [...phases].sort((a, b) => a.order_index - b.order_index);

  return (
    <div className={cn("flex items-center gap-1 overflow-x-auto", className)}>
      {sorted.map((phase, i) => {
        const { icon: Icon, className: iconClass } = resolvePhaseIcon(phase);
        return (
          <div key={phase.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-muted-foreground/50">›</span>}
            <div className="flex items-center gap-0.5 rounded border border-border/60 bg-transparent px-1.5 py-0.5 text-[10px] text-foreground/70">
              <Icon className={iconClass} />
              <span className="truncate max-w-[80px]">{phase.name}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
