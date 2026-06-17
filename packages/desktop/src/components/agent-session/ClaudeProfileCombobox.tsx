import { memo, useMemo, useRef, useState, type ReactElement } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { DEFAULT_CLAUDE_PROFILE_NAME, type ClaudeCodeProfile } from "@/api/agentRuntime";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ClaudeProfileComboboxProps {
  value: string;
  profiles: ClaudeCodeProfile[];
  isLoading: boolean;
  isError: boolean;
  onChange: (profile: string) => void;
  triggerClassName?: string;
  variant?: "default" | "compact";
  label?: string;
}

export const ClaudeProfileCombobox = memo(function ClaudeProfileCombobox({
  value,
  profiles,
  isLoading,
  isError,
  onChange,
  triggerClassName,
  variant = "default",
  label,
}: ClaudeProfileComboboxProps): ReactElement {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useProfileOptions(profiles);

  if (isLoading) {
    return (
      <span className={loadingClassName(variant)} aria-busy="true">
        Loading profiles…
      </span>
    );
  }

  if (isError) {
    return <span className="text-[11px] text-destructive">Failed to load profiles</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-label="Claude profile"
          aria-expanded={open}
          title={`Claude profile: ${formatProfileLabel(value)}`}
          className={cn(triggerBaseClassName(variant), triggerClassName)}
        >
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            {label && <span className="text-muted-foreground/80">{label}</span>}
            <span className="truncate">{formatProfileLabel(value)}</span>
          </span>
          <ChevronDownIcon className="size-3 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side={variant === "compact" ? "top" : undefined}
        className="w-64 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <Command shouldFilter>
          <CommandInput
            ref={inputRef}
            aria-label="Search Claude profiles"
            placeholder="Search profiles…"
            className="h-9 text-xs"
          />
          <CommandList className="max-h-48">
            <CommandEmpty className="py-3 text-center text-xs">No matching profiles.</CommandEmpty>
            <CommandGroup heading="Claude profiles">
              {options.map((profile) => (
                <CommandItem
                  key={profile.value}
                  value={profile.value}
                  className="text-xs"
                  onSelect={() => {
                    onChange(profile.value);
                    setOpen(false);
                  }}
                >
                  <span className="flex-1 truncate">{profile.label}</span>
                  {profile.value === value && <CheckIcon className="size-3" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

function triggerBaseClassName(variant: "default" | "compact"): string {
  if (variant === "compact") {
    return "inline-flex h-8 min-w-0 max-w-[180px] items-center justify-between gap-1.5 overflow-hidden whitespace-nowrap rounded-md border border-border bg-muted/40 px-2.5 text-[11px] font-medium text-foreground shadow-sm hover:bg-accent [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:opacity-70";
  }
  return "inline-flex h-8 min-w-32 items-center justify-between gap-2 whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-xs transition-[color,box-shadow] outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
}

function loadingClassName(variant: "default" | "compact"): string {
  if (variant === "compact") {
    return "inline-flex h-8 items-center rounded-md border border-border/50 bg-muted/30 px-2.5 text-[11px] text-muted-foreground";
  }
  return "text-[11px] text-muted-foreground";
}

function formatProfileLabel(profile: string): string {
  const normalized = profile.trim().toLowerCase();
  if (normalized === DEFAULT_CLAUDE_PROFILE_NAME || normalized === "default (recommended)") {
    return "Default";
  }
  return profile;
}

interface ProfileOption {
  value: string;
  label: string;
}

function useProfileOptions(profiles: ClaudeCodeProfile[]): ProfileOption[] {
  return useMemo(() => {
    const seen = new Set<string>([DEFAULT_CLAUDE_PROFILE_NAME]);
    const options: ProfileOption[] = [
      {
        value: DEFAULT_CLAUDE_PROFILE_NAME,
        label: formatProfileLabel(DEFAULT_CLAUDE_PROFILE_NAME),
      },
    ];
    profiles.forEach((profile) => {
      if (seen.has(profile.name)) return;
      seen.add(profile.name);
      options.push({ value: profile.name, label: formatProfileLabel(profile.name) });
    });
    return options;
  }, [profiles]);
}
