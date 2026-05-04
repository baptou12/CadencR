import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ArrowDownIcon,
  ChevronDownIcon,
  CheckIcon,
  FileEditIcon,
  GitBranchIcon,
} from "lucide-react";
import { ShortcutTooltip } from "../ShortcutTooltip";
import { AgentTodoList } from "../AgentTodoList";
import { SessionInfoChip } from "./SessionInfoChip";
import { WorktreeButtonGroup } from "./WorktreePopover";
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
import { findProviderMode, getVisibleModes } from "@/lib/provider-modes";
import type { PermissionMode } from "@/types/permission-mode";
import {
  AUTO_SCROLL_ACTIVE_CHIP,
  META_BAR_CHIP,
  REVIEW_CHANGES_CHIP,
  WORKTREE_ACTIVE_CHIP,
} from "./meta-bar-chip-styles";

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
  permissionMode?: PermissionMode;
  onPermissionModeToggle?: () => void;
  /**
   * Per-provider opt-in modes the user has unlocked via provider settings.
   * E.g. enabling "Allow BypassPermissions" for Claude Code adds
   * `"bypassPermissions"` to this list when the active provider is Claude.
   * Modes flagged `optIn: true` in the catalog are filtered out unless they
   * appear here.
   */
  enabledOptInModes?: PermissionMode[];
  showWorktreeChip: boolean;
  useWorktree?: boolean;
  onToggleWorktree?: () => void;
  /**
   * Optional richer two-chip worktree picker (Branch + Use worktree). When
   * the embedder provides every field below, the chip group replaces the
   * legacy on/off button. Embedders that don't supply these fall back to
   * the bare toggle.
   */
  worktreeProjectId?: number;
  worktreeDefaultBranch?: string;
  worktreeSelectedBranch?: string | null;
  onWorktreeBranchChange?: (next: string | null) => void;
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
  /**
   * When `true`, the auto-scroll, todos, and session-info chips are omitted
   * because the parent renders them in a separate `MetaBarSecondary` strip
   * below the prompt (used when the container is too narrow to fit them
   * inline with the model picker / mode / worktree chips).
   */
  secondaryBelow?: boolean;
}

export interface MetaBarHandle {
  openModelPicker: () => void;
}

// Theme-aware model picker pill. The original (pre-refactor) look stacked
// three violet shades — saturated mid (500) for the bg, lighter mid (400)
// for the border, lightest (300) for the text. Each comes from the theme:
//   --chip-violet-bg   ≈ violet-500
//   --chip-violet-fg   ≈ violet-400
//   --chip-violet-soft ≈ violet-300
const MODEL_GROUP =
  "inline-flex h-8 items-stretch rounded-md border border-[var(--chip-violet-fg)]/15 bg-[var(--chip-violet-bg)]/12 text-[11px] font-medium text-[var(--chip-violet-soft)] shadow-sm";
const MODEL_SEGMENT = "inline-flex h-full items-center gap-1.5 px-2.5 transition-colors";

export const MetaBar = forwardRef<MetaBarHandle, MetaBarProps>(function MetaBar(
  {
    showAutoScrollChip,
    autoScrollEnabled,
    onToggleAutoScroll,
    permissionMode,
    onPermissionModeToggle,
    enabledOptInModes,
    showWorktreeChip,
    useWorktree,
    onToggleWorktree,
    worktreeProjectId,
    worktreeDefaultBranch,
    worktreeSelectedBranch,
    onWorktreeBranchChange,
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
    secondaryBelow = false,
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

  // Hide the chip when the provider can't cycle (< 2 visible modes).
  const activeMode = useMemo(() => {
    if (!onPermissionModeToggle || !permissionMode) return null;
    const visibleModes = getVisibleModes(displayProviderId, enabledOptInModes ?? []);
    if (visibleModes.length < 2) return null;
    return findProviderMode(displayProviderId, permissionMode) ?? visibleModes[0];
  }, [displayProviderId, enabledOptInModes, onPermissionModeToggle, permissionMode]);

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
      {showAutoScrollChip && !secondaryBelow && (
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
      )}

      {/* Mode chip — labels/colors driven by the per-provider catalog. */}
      {activeMode && (
        <ShortcutTooltip label={`${activeMode.label} mode`} keys={["shift", "Tab"]}>
          <button
            type="button"
            onClick={onPermissionModeToggle}
            title={`${activeMode.description} (Shift+Tab to cycle)`}
            aria-label={`Permission mode: ${activeMode.label}. ${activeMode.description}`}
            className={cn(META_BAR_CHIP, activeMode.chipClass)}
          >
            <activeMode.icon className="size-3" />
            {activeMode.label}
          </button>
        </ShortcutTooltip>
      )}

      {/* Worktree chips — two-chip group (Branch + Use worktree) when the
          embedder provides projectId + branch state, else legacy single toggle. */}
      {showWorktreeChip &&
        (worktreeProjectId != null && onWorktreeBranchChange && onToggleWorktree ? (
          <WorktreeButtonGroup
            projectId={worktreeProjectId}
            defaultBranch={worktreeDefaultBranch}
            useWorktree={!!useWorktree}
            onToggleWorktree={onToggleWorktree}
            selectedBranch={worktreeSelectedBranch ?? null}
            onSelectedBranchChange={onWorktreeBranchChange}
          />
        ) : (
          <button
            type="button"
            onClick={onToggleWorktree}
            className={cn(
              META_BAR_CHIP,
              useWorktree
                ? WORKTREE_ACTIVE_CHIP
                : "bg-muted/50 text-muted-foreground hover:bg-muted/80",
            )}
          >
            <GitBranchIcon className="size-3" />
            Use worktree
            {useWorktree && <CheckIcon className="size-3" />}
          </button>
        ))}

      {/* Model chip */}
      {onModelChange && (
        <div className={MODEL_GROUP}>
          <ShortcutTooltip
            label="Open model picker"
            keys={["cmd", "P"]}
            disabled={internalModelPickerOpen}
          >
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
                  className={cn(
                    MODEL_SEGMENT,
                    "min-w-0 rounded-l-md hover:bg-[var(--chip-violet-bg)]/16",
                  )}
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
                <div className="w-px bg-[var(--chip-violet-soft)]/15" aria-hidden="true" />
                <ShortcutTooltip
                  label={`Thinking effort: ${THINKING_EFFORT_LABELS[displayedThinkingEffort]}`}
                  keys={["cmd", "T"]}
                >
                  <button
                    type="button"
                    onClick={handleThinkingEffortCycle}
                    className={cn(
                      MODEL_SEGMENT,
                      "rounded-r-md px-2 text-[var(--chip-violet-soft)] hover:bg-[var(--chip-violet-bg)]/10",
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
            className={cn(META_BAR_CHIP, REVIEW_CHANGES_CHIP)}
          >
            <FileEditIcon className="size-3" />
            Review Changes
          </button>
        </ShortcutTooltip>
      )}

      {/* Tasks chip */}
      {!secondaryBelow && todos && todos.length > 0 && (
        <AgentTodoList todos={todos} chipClass={META_BAR_CHIP} />
      )}

      {/* Session info */}
      {!secondaryBelow && runtimeSessionId && onPause && (
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
