import type { WorkflowPhase } from "@/api/generated";

const DEP_COLORS = [
  "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "bg-violet-500/20 text-violet-400 border-violet-500/30",
];

interface PhaseDependencyBadgesProps {
  inputPhases: WorkflowPhase[];
  onClickPhase: (id: number) => void;
}

export function PhaseDependencyBadges({ inputPhases, onClickPhase }: PhaseDependencyBadgesProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 ml-5">
      <span className="text-[10px] text-muted-foreground shrink-0">← from</span>
      {inputPhases.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClickPhase(p.id);
          }}
          className={`text-[10px] px-1.5 py-0 rounded border cursor-pointer hover:brightness-125 transition-colors ${DEP_COLORS[i % DEP_COLORS.length]}`}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
