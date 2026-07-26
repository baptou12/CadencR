import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useMonoFont } from "@/lib/fonts/mono-font-setting";
import { useSystemFonts } from "@/lib/fonts/useSystemFonts";
import { MONO_FONT_PREVIEW } from "@/lib/fonts/constants";
import { SettingsSubsection } from "./SettingsSubsection";

const DEFAULT_LABEL = "Default";

export function FontSelector(): React.JSX.Element {
  const { family, resolved, setFamily } = useMonoFont();
  const [showAll, setShowAll] = useState(false);
  const { fonts, error } = useSystemFonts(showAll);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Surface detection failure once per error transition (never swallow).
  useEffect(() => {
    if (error) toast.error("Font detection unavailable — using the default font.");
  }, [error]);

  const currentLabel = family ?? DEFAULT_LABEL;

  return (
    <SettingsSubsection
      title="Monospace font"
      description="Applies to the terminal, editor, and code snippets."
    >
      <div className="flex flex-col gap-3">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              role="combobox"
              aria-label="Monospace font"
              aria-expanded={open}
              className="inline-flex h-8 min-w-48 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-xs shadow-xs outline-none hover:bg-accent"
            >
              <span className="truncate">{currentLabel}</span>
              <ChevronDownIcon className="size-3 opacity-70" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-64 overflow-hidden p-0"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
          >
            <Command shouldFilter>
              <CommandInput ref={inputRef} placeholder="Search fonts…" className="h-9 text-xs" />
              <CommandList className="max-h-56">
                <CommandEmpty className="py-3 text-center text-xs">No matching fonts.</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value=""
                    className="text-xs"
                    onSelect={() => {
                      setFamily("");
                      setOpen(false);
                    }}
                  >
                    <span className="flex-1 truncate">{DEFAULT_LABEL}</span>
                    {family === null && <CheckIcon className="size-3" />}
                  </CommandItem>
                  {fonts.map((f) => (
                    <CommandItem
                      key={f}
                      value={f}
                      className="text-xs"
                      style={{ fontFamily: `"${f}"` }}
                      onSelect={() => {
                        setFamily(f);
                        setOpen(false);
                      }}
                    >
                      <span className="flex-1 truncate">{f}</span>
                      {family === f && <CheckIcon className="size-3" />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showAll} onCheckedChange={setShowAll} />
          Show all fonts (not just monospace)
        </label>

        {error && (
          <p className="text-[11px] text-destructive">
            Font detection unavailable — only the default font is available.
          </p>
        )}

        <pre
          data-testid="mono-font-preview"
          className="overflow-x-auto rounded-md border border-border/70 bg-muted/40 p-3 text-xs leading-relaxed"
          style={{ fontFamily: resolved }}
        >
          {MONO_FONT_PREVIEW}
        </pre>
      </div>
    </SettingsSubsection>
  );
}
