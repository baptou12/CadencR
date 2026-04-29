import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowDownIcon,
  ChevronDownIcon,
  CheckIcon,
  Zap,
  ClipboardList,
  FileEditIcon,
  GitBranchIcon,
} from "lucide-react";
import { ShortcutTooltip } from "../ShortcutTooltip";
import { AgentTodoList } from "../AgentTodoList";
import { SessionInfoChip } from "./SessionInfoChip";
import type { TodoItem } from "@/types/agent";
import { ProviderIcon } from "@/lib/provider-icons";
import { ThinkingEffortBars } from "@/components/ThinkingEffortBars";
import {
  RuntimeModelPicker,
  type RuntimeModelPickerProvider,
} from "@/components/RuntimeModelPicker";
import {
  THINKING_EFFORT_LABELS,
  nextThinkingEffort,
  type ThinkingEffortLevel,
} from "@/shared/thinking-effort";

interface Model {
  id: string;
  label: string;
  description?: string;
}

interface Provider {
  id: string;
  label: string;
  disabled?: boolean;
  models: Model[];
}

export interface MetaBarProps {
  showAutoScrollChip: boolean;
  autoScrollEnabled: boolean;
  onToggleAutoScroll: () => void;
  permissionMode?: "acceptEdits" | "plan";
  onPermissionModeToggle?: () => void;
  showWorktreeChip: boolean;
  useWorktree?: boolean;
  onToggleWorktree?: () => void;
  onProviderChange?: (providerId: string) => void;
  currentProviderId?: string;
  /**
   * Called when the user picks a model from the inline picker. The picker
   * always knows both the provider and the model the user just chose, so we
   * pass both — the parent must not read provider state from the WS store
   * here (no-optimistic-updates rule means it would be stale right after a
   * sibling provider change).
   */
  onModelChange?: (providerId: string, modelId: string) => void;
  currentThinkingEffort?: ThinkingEffortLevel;
  supportedThinkingEfforts?: ThinkingEffortLevel[];
  onThinkingEffortChange?: (thinkingEffort?: ThinkingEffortLevel) => void;
  currentModelId?: string;
  currentModelLabel: string;
  models: Model[];
  providers?: Provider[];
  canChangeProvider?: boolean;
  showDiffBar: boolean;
  onViewDiff?: () => void;
  todos?: TodoItem[] | null;
  runtimeProvider?: string;
  runtimeSessionId?: string;
  projectPath?: string;
  isRunning?: boolean;
  onPause?: () => void;
  onModelSelected?: () => void;
  /**
   * Layout variant. `"session"` (default) fades into the agent stream above
   * via a negative margin + background gradient. `"standalone"` drops that
   * styling so the bar can sit on its own inside a bordered container (used
   * for pre-agent kickoff prompts in PlanInputView / NextStepsBar).
   */
  variant?: "session" | "standalone";
}

export interface MetaBarHandle {
  openModelPicker: () => void;
}

const CHIP =
  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors";
const MODEL_GROUP =
  "inline-flex h-8 items-stretch rounded-md border border-violet-400/15 bg-violet-500/12 text-[11px] font-medium text-violet-300 shadow-sm";
const MODEL_SEGMENT = "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors";

export const MetaBar = forwardRef<MetaBarHandle, MetaBarProps>(function MetaBar(
  {
    showAutoScrollChip,
    autoScrollEnabled,
    onToggleAutoScroll,
    permissionMode,
    onPermissionModeToggle,
    showWorktreeChip,
    useWorktree,
    onToggleWorktree,
    onProviderChange,
    currentProviderId,
    onModelChange,
    currentThinkingEffort,
    supportedThinkingEfforts = [],
    onThinkingEffortChange,
    currentModelId,
    currentModelLabel,
    models,
    providers = [],
    canChangeProvider = false,
    showDiffBar,
    onViewDiff,
    todos,
    runtimeProvider,
    runtimeSessionId,
    projectPath,
    isRunning = false,
    onPause,
    onModelSelected,
    variant = "session",
  },
  ref,
) {
  const [internalModelPickerOpen, setInternalModelPickerOpen] = useState(false);
  const displayProviderId = currentProviderId ?? runtimeProvider;

  useImperativeHandle(
    ref,
    () => ({
      openModelPicker: () => setInternalModelPickerOpen(true),
    }),
    [],
  );
  const selectedThinkingEffort =
    currentThinkingEffort && supportedThinkingEfforts.includes(currentThinkingEffort)
      ? currentThinkingEffort
      : undefined;
  const displayedThinkingEffort = selectedThinkingEffort ?? supportedThinkingEfforts[0];
  const pickerProviders = useMemo<RuntimeModelPickerProvider[]>(() => {
    if (providers.length > 0) {
      return providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        disabled: !!provider.disabled,
        models: provider.models,
      }));
    }
    if (!displayProviderId) return [];
    return [
      {
        id: displayProviderId,
        label: displayProviderId,
        disabled: false,
        models,
      },
    ];
  }, [displayProviderId, models, providers]);

  const handleThinkingEffortCycle = (): void => {
    if (!supportedThinkingEfforts.length || !onThinkingEffortChange) return;
    onThinkingEffortChange(nextThinkingEffort(supportedThinkingEfforts, currentThinkingEffort));
  };

  const isStandalone = variant === "standalone";

  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        isStandalone ? "px-3 py-2" : "relative -mt-6 px-3 py-3 backdrop-blur-sm",
      )}
      style={
        isStandalone
          ? undefined
          : {
              background:
                "linear-gradient(to bottom, transparent 0%, hsl(var(--background) / 0.05) 10%, hsl(var(--background) / 0.12) 20%, hsl(var(--background) / 0.25) 35%, hsl(var(--background) / 0.45) 50%, hsl(var(--background) / 0.65) 65%, hsl(var(--background) / 0.82) 80%, hsl(var(--background) / 0.93) 90%, hsl(var(--background)) 100%)",
            }
      }
    >
      {showAutoScrollChip && (
        <button
          type="button"
          aria-pressed={autoScrollEnabled}
          onClick={onToggleAutoScroll}
          className={cn(
            CHIP,
            autoScrollEnabled
              ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25"
              : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
          )}
        >
          <ArrowDownIcon className="size-3" />
          Auto-scroll
          {autoScrollEnabled ? <CheckIcon className="size-3" /> : <span>Off</span>}
        </button>
      )}

      {/* Mode chip */}
      {onPermissionModeToggle && (
        <ShortcutTooltip
          label={permissionMode === "plan" ? "Plan mode" : "Auto mode"}
          keys={["shift", "Tab"]}
        >
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
            {permissionMode === "plan" ? (
              <ClipboardList className="size-3" />
            ) : (
              <Zap className="size-3" />
            )}
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
        <div className={MODEL_GROUP}>
          <ShortcutTooltip label="Open model picker" keys={["cmd", "P"]}>
            <RuntimeModelPicker
              open={internalModelPickerOpen}
              onOpenChange={setInternalModelPickerOpen}
              providers={pickerProviders}
              selectedProviderId={displayProviderId}
              selectedModelId={currentModelId}
              onAfterSelectClose={onModelSelected}
              onSelect={(providerId, modelId) => {
                if (canChangeProvider && onProviderChange && providerId !== displayProviderId) {
                  onProviderChange(providerId);
                }
                onModelChange(providerId, modelId);
              }}
              trigger={
                <button
                  type="button"
                  className={cn(MODEL_SEGMENT, "min-w-0 rounded-l-md hover:bg-violet-500/16")}
                >
                  <ProviderIcon
                    providerId={displayProviderId}
                    alt={currentModelLabel}
                    className="size-3.5 rounded-sm shrink-0"
                  />
                  <span className="truncate text-[11px] leading-none">{currentModelLabel}</span>
                  <ChevronDownIcon className="size-3 shrink-0" />
                </button>
              }
            />
          </ShortcutTooltip>

          {supportedThinkingEfforts.length > 0 &&
            onThinkingEffortChange &&
            displayedThinkingEffort && (
              <>
                <div className="w-px bg-violet-300/15" aria-hidden="true" />
                <ShortcutTooltip
                  label={`Thinking effort: ${THINKING_EFFORT_LABELS[displayedThinkingEffort]}`}
                  keys={["cmd", "T"]}
                >
                  <button
                    type="button"
                    onClick={handleThinkingEffortCycle}
                    className={cn(
                      MODEL_SEGMENT,
                      "rounded-r-md px-2 text-violet-300 hover:bg-violet-500/10",
                    )}
                    aria-label="Cycle thinking effort"
                  >
                    <ThinkingEffortBars
                      levels={supportedThinkingEfforts}
                      value={selectedThinkingEffort}
                      compact
                    />
                  </button>
                </ShortcutTooltip>
              </>
            )}
        </div>
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

      {/* Session info */}
      {runtimeSessionId && onPause && (
        <div className="ml-auto">
          <SessionInfoChip
            runtimeProvider={runtimeProvider}
            runtimeSessionId={runtimeSessionId}
            projectPath={projectPath}
            isRunning={isRunning}
            onPause={onPause}
            chipClass={CHIP}
          />
        </div>
      )}
    </div>
  );
});
