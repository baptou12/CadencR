import { useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface FeatureLabelEditorProps {
  value: string;
  suggestions: readonly string[];
  isSaving: boolean;
  trigger: ReactNode;
  onChange: (value: string) => void;
  /**
   * Save the current draft. Accepts an optional `override` so a suggestion
   * can be picked and saved in one step without waiting for the parent's
   * `value` prop to round-trip through React state.
   */
  onSave: (override?: string) => void;
  onCancel: () => void;
}

export function FeatureLabelEditor({
  value,
  suggestions,
  isSaving,
  trigger,
  onChange,
  onSave,
  onCancel,
}: FeatureLabelEditorProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  function focusInput(): void {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      // Always save the typed value. Prevent cmdk's default Enter behavior
      // (which would fire onSelect on the highlighted suggestion).
      event.preventDefault();
      event.stopPropagation();
      onSave();
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      // Autocomplete: if a suggestion is highlighted, fill the input with
      // it without saving. If nothing is highlighted, let Tab default
      // (move focus) so the user can reach the Save button.
      const root = event.currentTarget.closest<HTMLElement>("[cmdk-root]");
      const highlighted = root?.querySelector<HTMLElement>(
        '[cmdk-item][data-selected="true"], [cmdk-item][aria-selected="true"]',
      );
      if (!highlighted) return;
      const next = highlighted.getAttribute("data-value") ?? highlighted.textContent ?? "";
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      onChange(next);
      return;
    }
    // Don't stopPropagation for the rest — cmdk listens on the Command root
    // and needs to receive arrow keys to navigate the suggestions list.
  }

  function handleSuggestionSelect(label: string): void {
    onChange(label);
    // Save in the same gesture so arrow-down + Enter is a single step.
    onSave(label);
  }

  return (
    <Popover open>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0"
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 overflow-hidden p-0"
        data-ignore-feature-row-keydown
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onEscapeKeyDown={onCancel}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusInput();
        }}
        onInteractOutside={onCancel}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Command shouldFilter>
          <div className="border-b px-3 py-2 text-xs font-medium text-foreground">
            Set feature label
          </div>
          <CommandInput
            ref={inputRef}
            value={value}
            disabled={isSaving}
            aria-label="Feature label"
            autoFocus
            data-ignore-feature-row-keydown
            placeholder={isSaving ? "Saving label…" : "Set label"}
            className="h-9 text-xs"
            onValueChange={onChange}
            onKeyDown={handleKeyDown}
          />
          {suggestions.length > 0 && (
            <CommandList className="max-h-36">
              <CommandEmpty className="py-3 text-center text-xs">No matching labels.</CommandEmpty>
              <CommandGroup heading="Existing labels">
                {suggestions.map((label) => (
                  <CommandItem
                    key={label}
                    value={label}
                    className="text-xs"
                    onSelect={() => handleSuggestionSelect(label)}
                  >
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          )}
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <span className="text-[10.5px] text-muted-foreground">
              Tab autocompletes · Enter saves · Esc cancels
            </span>
            <Button type="button" size="xs" disabled={isSaving} onClick={() => onSave()}>
              {isSaving && (
                <Loader2Icon aria-label="Saving label" className="size-3 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
