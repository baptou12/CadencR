import { cn } from "@/lib/utils";

interface ProgressBarProps {
  completed: number;
  total: number;
  className?: string;
}

export function ProgressBar({ completed, total, className }: ProgressBarProps) {
  if (total <= 0) return null;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-300"
          style={{ width: `${(completed / total) * 100}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
        {completed}/{total}
      </span>
    </div>
  );
}
