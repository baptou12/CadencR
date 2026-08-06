import { CheckIcon } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandList, CommandItem } from "@/components/ui/command";

const DEFAULT_LABEL = "Default";

interface FontComboboxListProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  fonts: string[];
  family: string | null;
  onSelect: (family: string) => void;
}

export function FontComboboxList({ inputRef, fonts, family, onSelect }: FontComboboxListProps): React.JSX.Element {
  return (
    <Command shouldFilter>
      <CommandInput ref={inputRef} placeholder="Search fonts…" className="h-9 text-xs" />
      <CommandList className="max-h-56">
        <CommandEmpty className="py-3 text-center text-xs">No matching fonts.</CommandEmpty>
        <CommandGroup>
          <CommandItem value="" className="text-xs" onSelect={() => onSelect("")}>
            <span className="flex-1 truncate">{DEFAULT_LABEL}</span>
            {family === null && <CheckIcon className="size-3" />}
          </CommandItem>
          {fonts.map((f) => (
            <CommandItem
              key={f}
              value={f}
              className="text-xs"
              style={{ fontFamily: `"${f}"` }}
              onSelect={() => onSelect(f)}
            >
              <span className="flex-1 truncate">{f}</span>
              {family === f && <CheckIcon className="size-3" />}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
