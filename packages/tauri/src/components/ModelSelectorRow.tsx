import { Button } from "./ui/button";
import { ThinkingEffortBars } from "./ThinkingEffortBars";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { ProviderIcon } from "@/lib/provider-icons";
import { RuntimeModelPicker } from "@/components/RuntimeModelPicker";
import {
  THINKING_EFFORT_LABELS,
  nextThinkingEffort,
  type ThinkingEffortLevel,
} from "@/shared/thinking-effort";
import type { RuntimeModelOption } from "@/api/agentRuntime";
import { ChevronDownIcon } from "lucide-react";

export interface ModelSelectorRowProvider {
  id: string;
  label: string;
  disabled: boolean;
  models: RuntimeModelOption[];
}

interface ModelSelectorRowProps {
  agentLabel: string;
  stateLabel: string;
  level: "global" | "project" | "feature";
  selectedProviderId: string;
  selectedProviderLabel: string;
  selectedModelId: string;
  selectedModelLabel: string;
  selectedModelDescription?: string;
  providers: ModelSelectorRowProvider[];
  isInherited: boolean;
  onInherit?: () => void;
  onSelect: (providerId: string, modelId: string) => void;
  thinkingEffortLevels: ThinkingEffortLevel[];
  thinkingEffort?: ThinkingEffortLevel;
  onThinkingEffortChange?: (effort?: ThinkingEffortLevel) => void;
  icon: React.ReactNode;
}

export function ModelSelectorRow(props: ModelSelectorRowProps) {
  const {
    agentLabel,
    stateLabel,
    level,
    selectedProviderId,
    selectedProviderLabel,
    selectedModelId,
    selectedModelLabel,
    selectedModelDescription,
    providers,
    isInherited,
    onInherit,
    onSelect,
    thinkingEffortLevels,
    thinkingEffort,
    onThinkingEffortChange,
    icon,
  } = props;

  const tooltipEffort = thinkingEffort ?? thinkingEffortLevels[0];
  const inheritAction =
    level !== "global" && onInherit
      ? {
          id: "inherit-selection",
          label: "Inherit selection",
          description: `${selectedProviderLabel} / ${selectedModelLabel}`,
          selected: isInherited,
          keywords: [selectedProviderLabel, selectedModelLabel],
          onSelect: onInherit,
        }
      : undefined;

  const handleThinkingEffortCycle = (): void => {
    if (!onThinkingEffortChange || thinkingEffortLevels.length === 0) return;
    onThinkingEffortChange(nextThinkingEffort(thinkingEffortLevels, thinkingEffort));
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 items-center gap-2.5 sm:w-[180px] sm:flex-none">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{agentLabel}</div>
          <div className="truncate text-[11px] text-muted-foreground">{stateLabel}</div>
        </div>
      </div>
      <div className="flex min-w-0 w-full items-center gap-2 sm:flex-1">
        <div className="min-w-0 flex-1">
          <RuntimeModelPicker
            providers={providers}
            selectedProviderId={selectedProviderId}
            selectedModelId={selectedModelId}
            onSelect={onSelect}
            action={inheritAction}
            trigger={
              <Button
                variant="outline"
                role="combobox"
                className="h-10 w-full min-w-0 justify-between gap-3 rounded-lg border-border/70 bg-background/80 px-3 text-left text-xs font-normal shadow-sm"
                title={selectedModelDescription}
              >
                <span className="flex min-w-0 items-center gap-2.5 overflow-hidden">
                  <ProviderIcon
                    providerId={selectedProviderId}
                    alt={agentLabel}
                    className="size-4 shrink-0 rounded-sm"
                  />
                  <span className="min-w-0 truncate">
                    <span className="truncate text-sm text-foreground">
                      {selectedProviderLabel} / {selectedModelLabel}
                    </span>
                    {level !== "global" && isInherited && (
                      <span className="ml-1 hidden truncate text-[11px] text-muted-foreground sm:inline">
                        Inherited
                      </span>
                    )}
                  </span>
                </span>
                <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
              </Button>
            }
          />
        </div>
        {thinkingEffortLevels.length > 0 && (
          <ShortcutTooltip
            label={`Thinking effort: ${THINKING_EFFORT_LABELS[tooltipEffort]}`}
            above
          >
            <button
              type="button"
              onClick={handleThinkingEffortCycle}
              className="inline-flex h-10 shrink-0 items-center rounded-md px-1.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Cycle thinking effort"
            >
              <ThinkingEffortBars levels={thinkingEffortLevels} value={thinkingEffort} compact />
            </button>
          </ShortcutTooltip>
        )}
      </div>
    </div>
  );
}
