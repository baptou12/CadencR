import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Command, CommandEmpty, CommandInput, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  ModelGroup,
  ProviderStateGroup,
  SelectionGroup,
  getModelEntries,
  getProviderStateEntries,
  type ModelEntry,
  type ProviderStateEntry,
  type RuntimeModelPickerAction,
} from "./RuntimeModelPickerSections";

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

export type RuntimeModelSelectionResolver = (
  providerId: string,
  modelId: string,
  models: readonly RuntimeModelPickerModel[],
) => string;

interface RuntimeModelPickerProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger: React.ReactNode;
  providers: RuntimeModelPickerProvider[];
  selectedProviderId?: string;
  selectedModelId?: string;
  resolveSelectedModelId?: RuntimeModelSelectionResolver;
  onSelect: (providerId: string, modelId: string) => void;
  action?: RuntimeModelPickerAction;
  searchPlaceholder?: string;
  emptyText?: string;
  align?: "start" | "center" | "end";
  contentClassName?: string;
  onAfterSelectClose?: () => void;
}

interface SelectedModelValueParams {
  providers: RuntimeModelPickerProvider[];
  selectedProviderId?: string;
  selectedModelId?: string;
  resolveSelectedModelId?: RuntimeModelSelectionResolver;
}

function useSelectedModelValue({
  providers,
  selectedProviderId,
  selectedModelId,
  resolveSelectedModelId,
}: SelectedModelValueParams): string {
  return useMemo(() => {
    if (!selectedProviderId || !selectedModelId) return "";
    const providerModels = providers.find((provider) => provider.id === selectedProviderId)?.models;
    const modelId =
      providerModels && resolveSelectedModelId
        ? resolveSelectedModelId(selectedProviderId, selectedModelId, providerModels)
        : selectedModelId;
    return `${selectedProviderId}:${modelId}`;
  }, [providers, resolveSelectedModelId, selectedProviderId, selectedModelId]);
}

interface SelectedModelScrollParams {
  listRef: React.RefObject<HTMLDivElement | null>;
  resolvedOpen: boolean;
  search: string;
  selectedModelValue: string;
}

interface RuntimeModelPickerContentProps {
  action?: RuntimeModelPickerAction;
  align: "start" | "center" | "end";
  contentClassName?: string;
  emptyText: string;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  modelEntries: ModelEntry[];
  onActionSelect: () => void;
  onAfterSelectClose?: () => void;
  onModelSelect: (entry: ModelEntry) => void;
  providerStateEntries: ProviderStateEntry[];
  restoreFocusAfterCloseRef: RefObject<boolean>;
  search: string;
  searchPlaceholder: string;
  selectedCommandValue: string;
  selectedModelValue: string;
  setSearch: (value: string) => void;
}

function useScrollSelectedModel({
  listRef,
  resolvedOpen,
  search,
  selectedModelValue,
}: SelectedModelScrollParams): void {
  useEffect(() => {
    if (!resolvedOpen || !listRef.current) return undefined;

    const frameId = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;

      if (search.length === 0 && selectedModelValue) {
        // Query by the specific value rather than [data-selected="true"]:
        // cmdk's data-selected tracks the currently highlighted item, which
        // can drift after the user types and clears the search. data-value
        // is stable, so we always scroll to the actual selected model.
        const selectedItem = list.querySelector<HTMLElement>(
          `[data-value="${CSS.escape(selectedModelValue)}"]`,
        );
        if (selectedItem) {
          selectedItem.scrollIntoView({ block: "nearest" });
          return;
        }
      }

      list.scrollTop = 0;
    });

    return () => cancelAnimationFrame(frameId);
  }, [listRef, resolvedOpen, search, selectedModelValue]);
}

function RuntimeModelPickerContent({
  action,
  align,
  contentClassName,
  emptyText,
  inputRef,
  listRef,
  modelEntries,
  onActionSelect,
  onAfterSelectClose,
  onModelSelect,
  providerStateEntries,
  restoreFocusAfterCloseRef,
  search,
  searchPlaceholder,
  selectedCommandValue,
  selectedModelValue,
  setSearch,
}: RuntimeModelPickerContentProps): React.ReactElement {
  function focusSearchInput(): void {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
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
      <Command defaultValue={selectedCommandValue}>
        <CommandInput
          ref={inputRef}
          placeholder={searchPlaceholder}
          value={search}
          onValueChange={setSearch}
          className="h-9 text-xs"
        />
        <CommandList ref={listRef} className="max-h-[320px]">
          <CommandEmpty className="py-3 text-center text-xs">{emptyText}</CommandEmpty>
          {action ? <SelectionGroup action={action} onSelect={onActionSelect} /> : null}
          {modelEntries.length > 0 ? (
            <ModelGroup
              entries={modelEntries}
              selectedModelValue={selectedModelValue}
              onSelect={onModelSelect}
            />
          ) : null}
          {providerStateEntries.length > 0 ? (
            <ProviderStateGroup entries={providerStateEntries} />
          ) : null}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}

export function RuntimeModelPicker({
  open,
  onOpenChange,
  trigger,
  providers,
  selectedProviderId,
  selectedModelId,
  resolveSelectedModelId,
  onSelect,
  action,
  searchPlaceholder = "Search providers or models...",
  emptyText = "No matching model.",
  align = "start",
  contentClassName,
  onAfterSelectClose,
}: RuntimeModelPickerProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocusAfterCloseRef = useRef(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const resolvedOpen = open ?? internalOpen;
  const selectedModelValue = useSelectedModelValue({
    providers,
    selectedProviderId,
    selectedModelId,
    resolveSelectedModelId,
  });
  const selectedCommandValue = selectedModelValue || (action?.selected ? action.id : "");

  useEffect(() => {
    if (!resolvedOpen) setSearch("");
  }, [resolvedOpen]);

  useScrollSelectedModel({ listRef, resolvedOpen, search, selectedModelValue });

  const modelEntries = useMemo<ModelEntry[]>(() => getModelEntries(providers), [providers]);

  const providerStateEntries = useMemo<ProviderStateEntry[]>(
    () => getProviderStateEntries(providers),
    [providers],
  );

  function handleOpenChange(nextOpen: boolean): void {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  function handleActionSelect(): void {
    if (!action) return;
    restoreFocusAfterCloseRef.current = true;
    action.onSelect();
    handleOpenChange(false);
  }

  function handleModelSelect(entry: ModelEntry): void {
    restoreFocusAfterCloseRef.current = true;
    onSelect(entry.providerId, entry.modelId);
    handleOpenChange(false);
  }

  return (
    <Popover open={resolvedOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <RuntimeModelPickerContent
        action={action}
        align={align}
        contentClassName={contentClassName}
        emptyText={emptyText}
        inputRef={inputRef}
        listRef={listRef}
        modelEntries={modelEntries}
        onActionSelect={handleActionSelect}
        onAfterSelectClose={onAfterSelectClose}
        onModelSelect={handleModelSelect}
        providerStateEntries={providerStateEntries}
        restoreFocusAfterCloseRef={restoreFocusAfterCloseRef}
        search={search}
        searchPlaceholder={searchPlaceholder}
        selectedCommandValue={selectedCommandValue}
        selectedModelValue={selectedModelValue}
        setSearch={setSearch}
      />
    </Popover>
  );
}
