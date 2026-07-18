import { memo, type ReactElement } from "react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { getProviderMetadata } from "@/lib/providers";
import { thinkingEffortLabel, parseThinkingEffort } from "@/shared/thinking-effort";
import { cn } from "@/lib/utils";

interface SidebarProviderBadgeProps {
  providerId?: string | null;
  modelId?: string | null;
  thinkingEffort?: string | null;
  className?: string;
}

/**
 * Compact provider mark shown before the worktree icon on sidebar rows.
 * Hover reveals model + thinking effort on a single line.
 */
export const SidebarProviderBadge = memo(function SidebarProviderBadge({
  providerId,
  modelId,
  thinkingEffort,
  className,
}: SidebarProviderBadgeProps): ReactElement | null {
  const meta = getProviderMetadata(providerId, null, "mono");
  if (!meta?.iconSrc) return null;

  const effort = parseThinkingEffort(thinkingEffort ?? undefined);
  const modelLabel = modelId?.trim() || "Default";
  const thinkingLabel = effort ? thinkingEffortLabel(effort) : "Default";
  const detail = `${meta.label} · ${modelLabel} · ${thinkingLabel}`;

  return (
    <ShortcutTooltip label={detail} toRight className={cn("shrink-0", className)}>
      <span
        role="img"
        aria-label={detail}
        className="inline-flex size-3.5 items-center justify-center text-muted-foreground"
      >
        <img
          src={meta.iconSrc}
          alt={meta.label}
          className="provider-icon-mono size-3.5 rounded-[2px] opacity-80"
        />
      </span>
    </ShortcutTooltip>
  );
});
