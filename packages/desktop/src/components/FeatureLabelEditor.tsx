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
  onSave: () => void;
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
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onSave();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  }

  function handleSuggestionSelect(label: string): void {
    onChange(label);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
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
            <span className="text-[10.5px] text-muted-foreground">Enter saves · Esc cancels</span>
            <Button type="button" size="xs" disabled={isSaving} onClick={onSave}>
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
