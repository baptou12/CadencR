import type { ContextUsageState } from "@/hooks/useContextUsage";
import { cn } from "@/lib/utils";

function formatTokenCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

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
        {formatTokenCount(usage.totalTokens)} / {formatTokenCount(usage.contextWindow)}
      </span>
    </div>
  );
}
