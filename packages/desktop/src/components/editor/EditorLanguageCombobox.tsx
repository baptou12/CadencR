import { memo, useRef, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import {
  EDITOR_LANGUAGES,
  getEditorLanguageLabel,
  type EditorLanguageId,
} from "@/lib/editor-language";
import {
  isEditorLanguagePreference,
  type EditorLanguagePreference,
} from "@/lib/editor-language-overrides";
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

interface EditorLanguageComboboxProps {
  id: string;
  preference: EditorLanguagePreference;
  automaticLanguageId: EditorLanguageId;
  disabled: boolean;
  onChange: (preference: EditorLanguagePreference) => void;
}

export const EditorLanguageCombobox = memo(function EditorLanguageCombobox(
  props: EditorLanguageComboboxProps,
) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const automaticLabel = `Automatic (${getEditorLanguageLabel(props.automaticLanguageId)})`;
  const selectedLabel =
    props.preference === "auto" ? automaticLabel : getEditorLanguageLabel(props.preference);

  function selectPreference(value: string): void {
    if (!isEditorLanguagePreference(value)) return;
    props.onChange(value);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={(next) => !props.disabled && setOpen(next)}>
      <PopoverTrigger asChild>
        <Button
          id={props.id}
          type="button"
          role="combobox"
          variant="outline"
          aria-expanded={open}
          disabled={props.disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDownIcon className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Command label="Search languages" shouldFilter>
          <CommandInput
            ref={inputRef}
            aria-label="Search languages"
            placeholder="Search languages…"
          />
          <CommandList className="max-h-64">
            <CommandEmpty>No matching languages.</CommandEmpty>
            <CommandGroup heading="Languages">
              <LanguageComboboxItem
                value="auto"
                label={automaticLabel}
                selected={props.preference === "auto"}
                onSelect={selectPreference}
              />
              {EDITOR_LANGUAGES.map((language) => (
                <LanguageComboboxItem
                  key={language.id}
                  value={language.id}
                  label={language.label}
                  selected={props.preference === language.id}
                  onSelect={selectPreference}
                />
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

function LanguageComboboxItem({
  value,
  label,
  selected,
  onSelect,
}: {
  value: EditorLanguagePreference;
  label: string;
  selected: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <CommandItem value={value} keywords={[label]} onSelect={onSelect}>
      <span className="flex-1 truncate">{label}</span>
      {selected && <CheckIcon className="size-4" />}
    </CommandItem>
  );
}
