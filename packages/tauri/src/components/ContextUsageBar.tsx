import type { ReactElement } from "react";
import type { ContextUsageState } from "@/types/agent";
import { cn } from "@/lib/utils";
import { getContextUsageAppearance, type LoaderStyle } from "@/lib/loader-style";

export function ContextUsageBar({
  usage,
  className,
  loaderStyle,
  isStreaming,
}: {
  usage: ContextUsageState | null | undefined;
  className?: string;
  loaderStyle: LoaderStyle;
  isStreaming: boolean;
}): ReactElement | null {
  if (!usage) return null;

  const appearance = getContextUsageAppearance(usage.usageRatio);
  const hasUsage = usage.totalTokens > 0;

  return (
    <div className={cn("flex items-center gap-2 px-3 py-1", className)}>
      <div className="h-[2px] flex-1 rounded-full bg-muted">
        {hasUsage && (
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              loaderStyle === "usage-glow" && isStreaming
                ? "context-usage-glow"
                : appearance.barClassName,
            )}
            data-loader-style={loaderStyle}
            style={{
              width: `${Math.max(1, usage.usageRatio * 100)}%`,
              ...(loaderStyle === "usage-glow"
                ? {
                    backgroundColor: appearance.glowColor,
                    boxShadow: isStreaming
                      ? `0 0 4px ${appearance.glowColor}, 0 0 10px color-mix(in srgb, ${appearance.glowColor} 75%, transparent), 0 0 16px color-mix(in srgb, ${appearance.glowColor} 45%, transparent)`
                      : "none",
                  }
                : undefined),
            }}
          />
        )}
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {Math.round(usage.usageRatio * 100)}%
      </span>
    </div>
  );
}
