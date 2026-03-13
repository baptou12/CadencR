import type { ContextUsageState } from "@/hooks/useContextUsage";
import { cn } from "@/lib/utils";

function getBarColor(ratio: number): string {
  if (ratio > 0.9) return "bg-red-500";
  if (ratio > 0.8) return "bg-orange-500";
  if (ratio > 0.5) return "bg-yellow-500";
  return "bg-emerald-500";
}

export function ContextUsageBar({
  usage,
  className,
}: {
  usage: ContextUsageState | null | undefined;
  className?: string;
}) {
  if (!usage) return null;

  const color = getBarColor(usage.usageRatio);
  const hasUsage = usage.totalTokens > 0;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-1", className)}>
      <div className="h-[2px] flex-1 rounded-full bg-muted">
        {hasUsage && (
          <div
            className={cn("h-full rounded-full transition-all duration-300", color)}
            style={{ width: `${Math.max(1, usage.usageRatio * 100)}%` }}
          />
        )}
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {Math.round(usage.usageRatio * 100)}%
      </span>
    </div>
  );
}
