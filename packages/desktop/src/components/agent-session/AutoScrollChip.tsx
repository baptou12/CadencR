import { memo } from "react";
import { ArrowDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShortcutTooltip } from "../ShortcutTooltip";
import { AUTO_SCROLL_ACTIVE_CHIP, META_BAR_CHIP } from "./meta-bar-chip-styles";

interface AutoScrollChipProps {
  enabled: boolean;
  onToggle: () => void;
}

/**
 * Compact icon-only toggle for auto-scroll. Rendered identically inline in
 * `MetaBar` and in the wrap-around `MetaBarSecondary` row — keep the single
 * source of truth here so the visuals, a11y, and tooltip copy can't drift.
 *
 * The tooltip is left-aligned because the agent session sits on the left of
 * the workspace; a centered tooltip would clip behind the sidebar.
 */
export const AutoScrollChip = memo(function AutoScrollChip({
  enabled,
  onToggle,
}: AutoScrollChipProps) {
  return (
    <ShortcutTooltip
      label={
        enabled
          ? "Auto-scroll: on — follow new agent output"
          : "Auto-scroll: off — click to follow new agent output"
      }
      keys={["cmd", "shift", "S"]}
      alignLeft
    >
      <button
        type="button"
        aria-label="Auto-scroll"
        aria-pressed={enabled}
        onClick={onToggle}
        className={cn(
          META_BAR_CHIP,
          "px-2",
          enabled ? AUTO_SCROLL_ACTIVE_CHIP : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
        )}
      >
        <ArrowDownIcon className="size-3.5" />
      </button>
    </ShortcutTooltip>
  );
});
