import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CodexPermissionMode } from "@/types/codex-permission-mode";
import { CODEX_ACCESS_MODES, getCodexAccessMode } from "./meta-bar-codex-modes";
import { META_BAR_CHIP } from "./meta-bar-chip-styles";

interface CodexAccessModePopoverProps {
  mode: CodexPermissionMode;
  selectedMode?: CodexPermissionMode;
  isPending?: boolean;
  onChange: (mode: CodexPermissionMode) => void;
}

export function CodexAccessModePopover({
  mode,
  selectedMode = mode,
  isPending = false,
  onChange,
}: CodexAccessModePopoverProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const activeMode = getCodexAccessMode(mode);
  const selectedAccessMode = getCodexAccessMode(selectedMode);
  if (!activeMode || !selectedAccessMode) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={activeMode.description}
          aria-label={`Codex access mode: ${activeMode.label}. ${activeMode.description}`}
          className={cn(META_BAR_CHIP, activeMode.chipClass)}
        >
          <activeMode.icon className="size-3" />
          {activeMode.label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        className="w-[360px] space-y-3 p-3 text-xs"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div>
          <div className="text-sm font-semibold">Codex access mode</div>
          <p className="mt-1 text-muted-foreground">
            This conversation is using {activeMode.label}. Pick a mode below to update the global
            default for new Codex conversations. Existing conversations keep their stored access
            mode.
          </p>
        </div>
        <div className="space-y-1.5">
          {CODEX_ACCESS_MODES.map((option) => {
            const selected = option.id === selectedMode;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                disabled={isPending}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-muted/50",
                  selected && "border-border bg-muted/60",
                  isPending && "cursor-wait opacity-60",
                )}
                aria-pressed={selected}
              >
                <option.icon className={cn("mt-0.5 size-3.5 shrink-0", option.textClass)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {option.label}
                    {selected && (
                      <>
                        <CheckIcon className="size-3 text-[var(--acc-green)]" />
                        <span className="text-[10px] font-normal text-muted-foreground">
                          New default
                        </span>
                      </>
                    )}
                  </span>
                  <span className="mt-0.5 block leading-relaxed text-muted-foreground">
                    {option.longDescription}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
