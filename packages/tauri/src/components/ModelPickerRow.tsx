import { useState } from "react";
import { Button } from "./ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const INHERIT_VALUE = "__inherit__";

interface ModelOption {
  id: string;
  label: string;
}

interface ModelPickerRowProps {
  label: React.ReactNode;
  models: ModelOption[];
  currentValue: string;
  effectiveModel: string;
  showInherit: boolean;
  onSelect: (value: string) => void;
}

export { INHERIT_VALUE };

export function ModelPickerRow({ label, models, currentValue, effectiveModel, showInherit, onSelect }: ModelPickerRowProps) {
  const [open, setOpen] = useState(false);

  function getModelLabel(modelId: string): string {
    return models.find((m) => m.id === modelId)?.label ?? modelId;
  }

  const displayLabel =
    currentValue === INHERIT_VALUE
      ? `Inherit (${getModelLabel(effectiveModel)})`
      : getModelLabel(currentValue);

  function handleSelect(value: string): void {
    onSelect(value);
    setOpen(false);
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="h-7 flex-1 justify-between px-2 text-xs font-normal">
            <span className="truncate">{displayLabel}</span>
            <ChevronsUpDownIcon className="ml-1 size-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search models..." className="h-8 text-xs" />
            <CommandList>
              <CommandEmpty className="py-2 text-center text-xs">No model found.</CommandEmpty>
              <CommandGroup>
                {showInherit && (
                  <CommandItem value={INHERIT_VALUE} onSelect={() => handleSelect(INHERIT_VALUE)} className="text-xs">
                    <CheckIcon className={cn("mr-2 size-3", currentValue === INHERIT_VALUE ? "opacity-100" : "opacity-0")} />
                    Inherit ({getModelLabel(effectiveModel)})
                  </CommandItem>
                )}
                {models.map((model) => (
                  <CommandItem
                    key={model.id}
                    value={model.id}
                    keywords={[model.label]}
                    onSelect={() => handleSelect(model.id)}
                    className="text-xs"
                  >
                    <CheckIcon className={cn("mr-2 size-3", currentValue === model.id ? "opacity-100" : "opacity-0")} />
                    {model.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
