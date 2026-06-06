import { memo } from "react";
import { SplitSquareHorizontal, SplitSquareVertical, X } from "lucide-react";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import type { SplitOrientation } from "@/hooks/useTerminalState";

const ICON_BTN =
  "flex size-6 items-center justify-center rounded text-[var(--terminal-panel-icon)] transition-colors hover:bg-[var(--terminal-panel-icon-bg-hover)] hover:text-[var(--terminal-panel-icon-hover)]";

interface TerminalPaneToolbarProps {
  activePaneId: string | null;
  splitPane: (leafId: string | undefined, orientation: SplitOrientation) => string | null;
  onClose: () => void;
  canClose: boolean;
}

/** Floating split/close actions pinned to the top-right of the terminal panel. */
export const TerminalPaneToolbar = memo(function TerminalPaneToolbar({
  activePaneId,
  splitPane,
  onClose,
  canClose,
}: TerminalPaneToolbarProps) {
  return (
    <div className="absolute right-2 top-1 z-10 flex items-center gap-0.5">
      <ShortcutTooltip label="Split vertical" keys={["cmd", "D"]}>
        <button
          type="button"
          onClick={() => splitPane(activePaneId ?? undefined, "horizontal")}
          className={ICON_BTN}
        >
          <SplitSquareHorizontal className="size-3.5" />
        </button>
      </ShortcutTooltip>
      <ShortcutTooltip label="Split horizontal" keys={["cmd", "shift", "D"]} alignRight>
        <button
          type="button"
          onClick={() => splitPane(activePaneId ?? undefined, "vertical")}
          className={ICON_BTN}
        >
          <SplitSquareVertical className="size-3.5" />
        </button>
      </ShortcutTooltip>
      {canClose && (
        <ShortcutTooltip label="Close terminal" alignRight>
          <button type="button" onClick={onClose} className={ICON_BTN}>
            <X className="size-3" />
          </button>
        </ShortcutTooltip>
      )}
    </div>
  );
});
