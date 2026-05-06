import { useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, LockIcon } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProviderIcon } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";

export interface RuntimeModelPickerModel {
  id: string;
  label: string;
  description?: string;
}

export interface RuntimeModelPickerProvider {
  id: string;
  label: string;
  disabled: boolean;
  status?: "available" | "unavailable" | "coming_soon";
  statusMessage?: string;
  models: RuntimeModelPickerModel[];
}

interface RuntimeModelPickerAction {
  id: string;
  label: string;
  description?: string;
  selected: boolean;
  keywords?: string[];
  onSelect: () => void;
}

interface RuntimeModelPickerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: React.ReactNode;
  providers: RuntimeModelPickerProvider[];
  selectedProviderId?: string;
  selectedModelId?: string;
  onSelect: (providerId: string, modelId: string) => void;
  action?: RuntimeModelPickerAction;
  searchPlaceholder?: string;
  emptyText?: string;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  onAfterSelectClose?: () => void;
}

interface ModelEntry {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  description?: string;
}

interface ProviderStateEntry {
  providerId: string;
  providerLabel: string;
  statusLabel: string;
}

export function RuntimeModelPicker({
  open,
  onOpenChange,
  trigger,
  providers,
  selectedProviderId,
  selectedModelId,
  onSelect,
  action,
  searchPlaceholder = "Search providers or models...",
  emptyText = "No matching model.",
  align = "start",
  contentClassName,
  onAfterSelectClose,
}: RuntimeModelPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusAfterCloseRef = useRef(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const resolvedOpen = open ?? internalOpen;

  useEffect(() => {
    if (!resolvedOpen) setSearch("");
  }, [resolvedOpen]);

  const modelEntries = useMemo<ModelEntry[]>(
    () =>
      providers.flatMap((provider) => {
        if (provider.disabled || provider.models.length === 0) return [];
        return provider.models.map((model) => ({
          providerId: provider.id,
          providerLabel: provider.label,
          modelId: model.id,
          modelLabel: model.label,
          description: model.description,
        }));
      }),
    [providers],
  );

  const providerStateEntries = useMemo<ProviderStateEntry[]>(
    () =>
      providers.flatMap((provider) => {
        if (!provider.disabled && provider.models.length > 0) return [];
        return [
          {
            providerId: provider.id,
            providerLabel: provider.label,
            statusLabel: provider.disabled
              ? provider.status === "unavailable"
                ? (provider.statusMessage ?? "Unavailable")
                : "Coming soon"
              : "No models available",
          },
        ];
      }),
    [providers],
  );

  function focusSearchInput(): void {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <Popover open={resolvedOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn("w-[340px] p-0", contentClassName)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusSearchInput();
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusAfterCloseRef.current) return;
          restoreFocusAfterCloseRef.current = false;
          event.preventDefault();
          onAfterSelectClose?.();
        }}
      >
        <Command>
          <CommandInput
            ref={inputRef}
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            className="h-9 text-xs"
          />
          <CommandList className="max-h-[320px]">
            <CommandEmpty className="py-3 text-center text-xs">{emptyText}</CommandEmpty>
            {action ? (
              <CommandGroup heading="Selection">
                <CommandItem
                  value={action.id}
                  keywords={action.keywords}
                  onSelect={() => {
                    restoreFocusAfterCloseRef.current = true;
                    action.onSelect();
                    handleOpenChange(false);
                  }}
                  className="flex items-start gap-2 text-xs"
                >
                  <CheckIcon
                    className={cn(
                      "mt-0.5 size-3 shrink-0",
                      action.selected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-foreground">{action.label}</span>
                    {action.description ? (
                      <span className="truncate text-[11px] text-muted-foreground">
                        {action.description}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}

            {modelEntries.length > 0 ? (
              <CommandGroup heading="Models">
                {modelEntries.map((entry) => (
                  <CommandItem
                    key={`${entry.providerId}:${entry.modelId}`}
                    value={`${entry.providerId}:${entry.modelId}`}
                    keywords={[
                      entry.providerLabel,
                      entry.providerId,
                      entry.modelLabel,
                      entry.modelId,
                      entry.description ?? "",
                    ]}
                    onSelect={() => {
                      restoreFocusAfterCloseRef.current = true;
                      onSelect(entry.providerId, entry.modelId);
                      handleOpenChange(false);
                    }}
                    className="flex items-start justify-between gap-2 text-xs"
                    title={entry.description}
                  >
                    <span className="flex min-w-0 items-start gap-2">
                      <ProviderIcon
                        providerId={entry.providerId}
                        alt={entry.modelLabel}
                        className="mt-0.5 size-3.5 shrink-0 rounded-sm"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-foreground">
                          {entry.providerLabel} / {entry.modelLabel}
                        </span>
                        {entry.description ? (
                          <span className="truncate text-[11px] text-muted-foreground">
                            {entry.description}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <CheckIcon
                      className={cn(
                        "mt-0.5 size-3 shrink-0 text-violet-400",
                        entry.providerId === selectedProviderId && entry.modelId === selectedModelId
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {providerStateEntries.length > 0 ? (
              <CommandGroup heading="Providers">
                {providerStateEntries.map((entry) => (
                  <CommandItem
                    key={`${entry.providerId}:state`}
                    value={`${entry.providerId}:state`}
                    keywords={[entry.providerLabel, entry.providerId, entry.statusLabel]}
                    disabled
                    className="flex items-start gap-2 text-xs"
                  >
                    <LockIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-muted-foreground">{entry.providerLabel}</span>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {entry.statusLabel}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
