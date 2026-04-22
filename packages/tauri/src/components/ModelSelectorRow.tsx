import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ThinkingEffortBars } from "./ThinkingEffortBars";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { ProviderIcon } from "@/lib/provider-icons";
import {
  THINKING_EFFORT_LABELS,
  nextThinkingEffort,
  type ThinkingEffortLevel,
} from "@/shared/thinking-effort";
import type { RuntimeModelOption } from "@/api/agentRuntime";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

interface RowProvider {
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
  providers: RowProvider[];
  isInherited: boolean;
  isModelSelected: (providerId: string, modelId: string) => boolean;
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
    isModelSelected,
    onInherit,
    onSelect,
    thinkingEffortLevels,
    thinkingEffort,
    onThinkingEffortChange,
    icon,
  } = props;

  const tooltipEffort = thinkingEffort ?? thinkingEffortLevels[0];
  const handleThinkingEffortCycle = (): void => {
    if (!onThinkingEffortChange || thinkingEffortLevels.length === 0) return;
    onThinkingEffortChange(nextThinkingEffort(thinkingEffortLevels, thinkingEffort));
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{agentLabel}</div>
          <div className="text-[11px] text-muted-foreground sm:max-w-[180px]">{stateLabel}</div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 sm:w-auto sm:shrink-0">
        <div className="min-w-0 w-full sm:w-auto sm:shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                className="h-10 w-full justify-between gap-3 rounded-lg border-border/70 bg-background/80 px-3 text-left text-xs font-normal shadow-sm sm:min-w-[260px] sm:max-w-[360px]"
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
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[260px]">
              <DropdownMenuLabel className="text-xs">Models</DropdownMenuLabel>
              {level !== "global" && onInherit && (
                <DropdownMenuItem onClick={onInherit} className="text-xs">
                  {isInherited && <CheckIcon className="size-3 text-violet-400" />}
                  Inherit selection
                </DropdownMenuItem>
              )}
              {providers.map((provider) => (
                <DropdownMenuSub key={provider.id}>
                  <DropdownMenuSubTrigger
                    className="text-xs data-[disabled]:text-muted-foreground"
                    disabled={provider.disabled}
                  >
                    <ProviderIcon
                      providerId={provider.id}
                      alt={provider.label}
                      className="size-3.5 rounded-sm"
                    />
                    <span className={provider.disabled ? "text-muted-foreground" : undefined}>
                      {provider.label}
                    </span>
                    {provider.id === selectedProviderId && (
                      <CheckIcon className="ml-1 size-3 text-violet-400" />
                    )}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-[240px]">
                    <DropdownMenuLabel className="text-xs">Model</DropdownMenuLabel>
                    {provider.disabled && (
                      <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                        Coming soon
                      </DropdownMenuItem>
                    )}
                    {!provider.disabled &&
                      provider.models.map((model) => (
                        <DropdownMenuItem
                          key={model.id}
                          onClick={() => onSelect(provider.id, model.id)}
                          className="flex items-start justify-between gap-2 text-xs"
                          title={model.description}
                        >
                          <span className="flex items-start gap-2 min-w-0">
                            <ProviderIcon
                              providerId={provider.id}
                              alt={model.label}
                              className="size-3.5 rounded-sm mt-0.5 shrink-0"
                            />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="truncate text-foreground">{model.label}</span>
                              {model.description && (
                                <span className="truncate text-[11px] text-muted-foreground">
                                  {model.description}
                                </span>
                              )}
                            </span>
                          </span>
                          {isModelSelected(provider.id, model.id) && (
                            <CheckIcon className="size-3 text-violet-400 shrink-0 mt-0.5" />
                          )}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {thinkingEffortLevels.length > 0 && (
          <ShortcutTooltip
            label={`Thinking effort: ${THINKING_EFFORT_LABELS[tooltipEffort]}`}
            above
          >
            <button
              type="button"
              onClick={handleThinkingEffortCycle}
              className="inline-flex h-10 items-center rounded-md px-1.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
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
