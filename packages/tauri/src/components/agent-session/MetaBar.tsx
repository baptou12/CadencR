import { cn } from "@/lib/utils";
import {
  ChevronDownIcon,
  CheckIcon,
  Zap,
  ClipboardList,
  FileEditIcon,
  GitBranchIcon,
} from "lucide-react";
import { ShortcutTooltip } from "../ShortcutTooltip";
import { AgentTodoList } from "../AgentTodoList";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { TodoItem } from "@/types/agent";

interface Model {
  id: string;
  label: string;
}

export interface MetaBarProps {
  permissionMode?: "acceptEdits" | "plan";
  onPermissionModeToggle?: () => void;
  showWorktreeChip: boolean;
  useWorktree?: boolean;
  onToggleWorktree?: () => void;
  onModelChange?: (modelId: string) => void;
  currentModelId?: string;
  currentModelLabel: string;
  models: Model[];
  showDiffBar: boolean;
  onViewDiff?: () => void;
  todos?: TodoItem[] | null;
  claudeSessionId?: string;
}

const CHIP =
  "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors";

export function MetaBar({
  permissionMode,
  onPermissionModeToggle,
  showWorktreeChip,
  useWorktree,
  onToggleWorktree,
  onModelChange,
  currentModelId,
  currentModelLabel,
  models,
  showDiffBar,
  onViewDiff,
  todos,
  claudeSessionId,
}: MetaBarProps) {
  return (
    <div
      className="relative -mt-6 flex items-center gap-1.5 px-3 py-3 backdrop-blur-sm"
      style={{
        background:
          "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.05) 10%, hsl(var(--background) / 0.12) 20%, hsl(var(--background) / 0.25) 35%, hsl(var(--background) / 0.45) 50%, hsl(var(--background) / 0.65) 65%, hsl(var(--background) / 0.82) 80%, hsl(var(--background) / 0.93) 90%, hsl(var(--background)) 100%)",
      }}
    >
      {/* Mode chip */}
      {onPermissionModeToggle && (
        <ShortcutTooltip label={permissionMode === "plan" ? "Plan mode" : "Auto mode"} keys={["shift", "Tab"]}>
          <button
            type="button"
            onClick={onPermissionModeToggle}
            title="Toggle permission mode (Shift+Tab)"
            className={cn(
              CHIP,
              permissionMode === "plan"
                ? "bg-green-500/15 text-green-400 hover:bg-green-500/25"
                : "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25",
            )}
          >
            {permissionMode === "plan" ? <ClipboardList className="size-3" /> : <Zap className="size-3" />}
            {permissionMode === "plan" ? "Plan" : "Auto"}
          </button>
        </ShortcutTooltip>
      )}

      {/* Worktree chip */}
      {showWorktreeChip && (
        <button
          type="button"
          onClick={onToggleWorktree}
          className={cn(
            CHIP,
            useWorktree
              ? "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30"
              : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
          )}
        >
          <GitBranchIcon className="size-3" />
          Use worktree
          {useWorktree && <CheckIcon className="size-3" />}
        </button>
      )}

      {/* Model chip */}
      {onModelChange && (
        <DropdownMenu>
          <ShortcutTooltip label="Switch model" keys={["cmd", "P"]}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(CHIP, "bg-violet-500/15 text-violet-400 hover:bg-violet-500/25")}
              >
                {currentModelLabel}
                <ChevronDownIcon className="size-3" />
              </button>
            </DropdownMenuTrigger>
          </ShortcutTooltip>
          <DropdownMenuContent align="start" className="min-w-[160px]">
            {models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => onModelChange(m.id)}
                className="flex items-center justify-between gap-2 text-xs"
              >
                {m.label}
                {m.id === currentModelId && <CheckIcon className="size-3 text-violet-400" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Review Changes chip */}
      {showDiffBar && (
        <ShortcutTooltip label="Review Changes" keys={["cmd", "D"]}>
          <button
            type="button"
            onClick={onViewDiff}
            className={cn(CHIP, "bg-orange-500/15 text-orange-400 hover:bg-orange-500/25")}
          >
            <FileEditIcon className="size-3" />
            Review Changes
          </button>
        </ShortcutTooltip>
      )}

      {/* Tasks chip */}
      {todos && todos.length > 0 && <AgentTodoList todos={todos} chipClass={CHIP} />}

      {/* Session ID */}
      {claudeSessionId && (
        <span className="ml-auto select-all font-mono text-[10px] text-muted-foreground/50">
          {claudeSessionId}
        </span>
      )}
    </div>
  );
}
