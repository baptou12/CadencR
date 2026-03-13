import { Loader2Icon, CheckCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackgroundTasksBadgeProps {
  activeCount: number;
  totalCount: number;
  onClick: () => void;
}

export function BackgroundTasksBadge({
  activeCount,
  totalCount,
  onClick,
}: BackgroundTasksBadgeProps) {
  if (totalCount === 0) return null;

  const allDone = activeCount === 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full px-1.5 py-0.5",
        "text-[10px] tabular-nums text-muted-foreground",
        "bg-muted/60 hover:bg-muted transition-colors",
        "border border-border/50",
      )}
      title="Background tasks"
    >
      {allDone ? (
        <CheckCircleIcon className="size-2.5 text-emerald-500" />
      ) : (
        <Loader2Icon className="size-2.5 animate-spin text-blue-400" />
      )}
      <span>{totalCount}</span>
    </button>
  );
}
