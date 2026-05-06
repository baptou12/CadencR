import type { ReactElement } from "react";
import {
  normalizeContextWindow,
  type ContextUsageState,
  usageRatio as computeUsageRatio,
} from "@/types/agent";
import { cn } from "@/lib/utils";
import { getContextUsageAppearance, type LoaderStyle } from "@/lib/loader-style";
import { KbdShortcut } from "@/components/KbdShortcut";

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
  if (normalizeContextWindow(usage.contextWindow) == null) return null;

  const ratio = computeUsageRatio(usage);
  const appearance = getContextUsageAppearance(ratio);

  return (
    <div className={cn("flex items-center gap-2 px-3 py-1", className)}>
      <div className="h-[3px] flex-1 rounded-full bg-border/80">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            loaderStyle === "usage-glow" && isStreaming
              ? "context-usage-glow"
              : appearance.barClassName,
          )}
          data-loader-style={loaderStyle}
          style={{
            width: `${ratio * 100}%`,
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
      </div>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
        {Math.round(ratio * 100)}%
      </span>
      <PromptKeyboardHint />
    </div>
  );
}

function PromptKeyboardHint(): ReactElement {
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
      <KbdShortcut keys={["enter"]} variant="hint" />
      <span>send</span>
      <span className="text-muted-foreground">·</span>
      <KbdShortcut keys={["shift", "enter"]} variant="hint" />
      <span>newline</span>
    </span>
  );
}
