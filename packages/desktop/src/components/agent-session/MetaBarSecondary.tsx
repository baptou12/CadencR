import { memo } from "react";
import { ArrowDownIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentTodoList } from "../AgentTodoList";
import { ShortcutTooltip } from "../ShortcutTooltip";
import { SessionInfoChip } from "./SessionInfoChip";
import type { TodoItem } from "@/types/agent";
import { AUTO_SCROLL_ACTIVE_CHIP, META_BAR_CHIP } from "./meta-bar-chip-styles";

/**
 * Compact strip rendered *below* the prompt when the agent session container
 * is too narrow to fit every chip on a single row of the main `MetaBar`.
 *
 * Hosts the chips that don't need to live next to the model picker:
 *   - auto-scroll toggle
 *   - todos popover
 *   - session info popover (pushed to the right with `ml-auto`)
 *
 * Keep this component visually identical to the inline version inside
 * `MetaBar` — the only difference is its position in the DOM.
 */

export interface MetaBarSecondaryProps {
  showAutoScrollChip: boolean;
  autoScrollEnabled: boolean;
  onToggleAutoScroll: () => void;
  todos?: TodoItem[] | null;
  runtimeProvider?: string;
  runtimeSessionId?: string;
  projectPath?: string;
  isRunning?: boolean;
  onPause?: () => void;
}

export const MetaBarSecondary = memo(function MetaBarSecondary({
  showAutoScrollChip,
  autoScrollEnabled,
  onToggleAutoScroll,
  todos,
  runtimeProvider,
  runtimeSessionId,
  projectPath,
  isRunning = false,
  onPause,
}: MetaBarSecondaryProps) {
  const hasTodos = todos && todos.length > 0;
  const hasInfo = runtimeSessionId && onPause;
  if (!showAutoScrollChip && !hasTodos && !hasInfo) return null;

  return (
    <div className="-mt-1 flex items-center gap-1.5 px-3 pb-2 pt-0">
      {showAutoScrollChip && (
        <ShortcutTooltip
          label={autoScrollEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
          keys={["cmd", "shift", "S"]}
        >
          <button
            type="button"
            aria-pressed={autoScrollEnabled}
            onClick={onToggleAutoScroll}
            className={cn(
              META_BAR_CHIP,
              autoScrollEnabled
                ? AUTO_SCROLL_ACTIVE_CHIP
                : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
            )}
          >
            <ArrowDownIcon className="size-3" />
            Auto-scroll
            {autoScrollEnabled ? <CheckIcon className="size-3" /> : <span>Off</span>}
          </button>
        </ShortcutTooltip>
      )}

      {hasTodos && <AgentTodoList todos={todos} chipClass={META_BAR_CHIP} />}

      {hasInfo && (
        <div className="ml-auto">
          <SessionInfoChip
            runtimeProvider={runtimeProvider}
            runtimeSessionId={runtimeSessionId}
            projectPath={projectPath}
            isRunning={isRunning}
            onPause={onPause}
            chipClass={META_BAR_CHIP}
          />
        </div>
      )}
    </div>
  );
});
