import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { StarIcon } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandList,
  useCommandState,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ResolvedShortcutHint } from "@/components/KbdShortcut";
import { useFavoriteModels } from "@/hooks/useFavoriteModels";
import { useShortcut } from "@/hooks/useShortcut";
import { cn } from "@/lib/utils";
import {
  ModelGroup,
  ProviderStateGroup,
  SelectionGroup,
  getModelEntries,
  getProviderStateEntries,
  partitionModelEntries,
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

interface FavoriteShortcutProps {
  onToggleHighlighted: () => void;
}

interface ModelGroupSpec {
  heading: string;
  entries: ModelEntry[];
}

interface RuntimeModelPickerContentProps {
  action?: RuntimeModelPickerAction;
  align: "start" | "center" | "end";
  contentClassName?: string;
  emptyText: string;
  favorites: ReadonlySet<string>;
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  modelGroups: ModelGroupSpec[];
  onActionSelect: () => void;
  onAfterSelectClose?: () => void;
  onModelSelect: (entry: ModelEntry) => void;
  onToggleFavorite: (value: string) => void;
  onToggleHighlightedFavorite: () => void;
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

/**
 * Model rows split into their rendered groups, plus the star-the-highlighted-row
 * action. Starred models get their own group above the rest; since cmdk only
 * filters *within* a group, they stay on top whether or not a search is active.
 */
function useModelGroups(
  providers: RuntimeModelPickerProvider[],
  listRef: RefObject<HTMLDivElement | null>,
): {
  favorites: ReadonlySet<string>;
  modelGroups: ModelGroupSpec[];
  toggleFavorite: (value: string) => void;
  toggleHighlightedFavorite: () => void;
} {
  const { favorites, toggleFavorite } = useFavoriteModels();
  const allEntries = useMemo<ModelEntry[]>(() => getModelEntries(providers), [providers]);

  const modelGroups = useMemo<ModelGroupSpec[]>(() => {
    const { favorite, rest } = partitionModelEntries(allEntries, favorites);
    const groups =
      favorite.length > 0
        ? [
            { heading: "Starred", entries: favorite },
            { heading: "All models", entries: rest },
          ]
        : [{ heading: "Models", entries: rest }];
    return groups.filter((group) => group.entries.length > 0);
  }, [allEntries, favorites]);

  const modelValues = useMemo(() => new Set(allEntries.map((entry) => entry.value)), [allEntries]);

  const toggleHighlightedFavorite = useCallback(() => {
    // cmdk owns the highlight, so the DOM is the only place it's readable.
    const highlighted = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    const value = highlighted?.dataset.value;
    // Skips the action and provider-state rows, which aren't starrable.
    if (!value || !modelValues.has(value)) return;
    toggleFavorite(value);
  }, [listRef, modelValues, toggleFavorite]);

  return useMemo(
    () => ({ favorites, modelGroups, toggleFavorite, toggleHighlightedFavorite }),
    [favorites, modelGroups, toggleFavorite, toggleHighlightedFavorite],
  );
}

/**
 * Binds the star shortcut and shows its footer hint (the star affordance
 * itself is hover-only, so the chord needs a permanent home).
 *
 * Rendered inside the popover content, so the binding exists only while a
 * picker is actually open — that, not an `enabled` flag, is what keeps it
 * from competing with the editor's and browser's own ⌘S.
 */
function FavoriteShortcut({ onToggleHighlighted }: FavoriteShortcutProps): React.ReactNode {
  // Hides the hint when the search filters everything out — there is no
  // highlighted row for the chord to act on.
  const hasMatches = useCommandState((state) => state.filtered.count > 0);

  useShortcut(
    "model-picker-favorite",
    (event) => {
      event.preventDefault();
      onToggleHighlighted();
    },
    undefined,
    [onToggleHighlighted],
  );

  if (!hasMatches) return null;

  return (
    <div className="flex items-center gap-1.5 border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <StarIcon className="size-3 shrink-0" />
      <span>Star / unstar</span>
      <ResolvedShortcutHint shortcutId="model-picker-favorite" />
    </div>
  );
}

function RuntimeModelPickerContent({
  action,
  align,
  contentClassName,
  emptyText,
  favorites,
  inputRef,
  listRef,
  modelGroups,
  onActionSelect,
  onAfterSelectClose,
  onModelSelect,
  onToggleFavorite,
  onToggleHighlightedFavorite,
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
          {modelGroups.map((group) => (
            <ModelGroup
              key={group.heading}
              heading={group.heading}
              entries={group.entries}
              selectedModelValue={selectedModelValue}
              favorites={favorites}
              onSelect={onModelSelect}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
          {providerStateEntries.length > 0 ? (
            <ProviderStateGroup entries={providerStateEntries} />
          ) : null}
        </CommandList>
        {modelGroups.length > 0 ? (
          <FavoriteShortcut onToggleHighlighted={onToggleHighlightedFavorite} />
        ) : null}
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

  const { favorites, modelGroups, toggleFavorite, toggleHighlightedFavorite } = useModelGroups(
    providers,
    listRef,
  );

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
        favorites={favorites}
        inputRef={inputRef}
        listRef={listRef}
        modelGroups={modelGroups}
        onActionSelect={handleActionSelect}
        onAfterSelectClose={onAfterSelectClose}
        onModelSelect={handleModelSelect}
        onToggleFavorite={toggleFavorite}
        onToggleHighlightedFavorite={toggleHighlightedFavorite}
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
