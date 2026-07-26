import { CheckIcon, LockIcon, StarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { favoriteModelKey } from "@/lib/favorite-models";
import { ProviderIcon } from "@/lib/provider-icons";
import { cn } from "@/lib/utils";
import type { RuntimeModelPickerProvider } from "./RuntimeModelPicker.types";

export interface RuntimeModelPickerAction {
  id: string;
  label: string;
  description?: string;
  selected: boolean;
  keywords?: string[];
  onSelect: () => void;
}

export interface ModelEntry {
  providerId: string;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  description?: string;
  value: string;
  keywords: string[];
}

export interface ProviderStateEntry {
  providerId: string;
  providerLabel: string;
  statusLabel: string;
  value: string;
  keywords: string[];
}

interface SelectionGroupProps {
  action: RuntimeModelPickerAction;
  onSelect: () => void;
}

interface ModelGroupProps {
  heading: string;
  entries: ModelEntry[];
  selectedModelValue: string;
  favorites: ReadonlySet<string>;
  onSelect: (entry: ModelEntry) => void;
  onToggleFavorite: (value: string) => void;
}

interface ModelItemProps {
  entry: ModelEntry;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: (entry: ModelEntry) => void;
  onToggleFavorite: (value: string) => void;
}

interface FavoriteToggleProps {
  isFavorite: boolean;
  modelLabel: string;
  onToggle: () => void;
}

interface ProviderStateGroupProps {
  entries: ProviderStateEntry[];
}

export function getModelEntries(providers: RuntimeModelPickerProvider[]): ModelEntry[] {
  return providers.flatMap((provider) => {
    if (provider.disabled || provider.models.length === 0) return [];
    return provider.models.map((model) => ({
      providerId: provider.id,
      providerLabel: provider.label,
      modelId: model.id,
      modelLabel: model.label,
      description: model.description,
      value: favoriteModelKey(provider.id, model.id),
      keywords: [provider.label, provider.id, model.label, model.id, model.description ?? ""],
    }));
  });
}

/**
 * Splits the catalog into starred and unstarred entries, preserving catalog
 * order within each half. Starred models render in their own group above the
 * rest — and because cmdk only ever filters *within* a group, they stay on top
 * whether or not a search filter is active. An entry appears in exactly one
 * group: duplicating a cmdk `value` would break selection and highlighting.
 */
export function partitionModelEntries(
  entries: ModelEntry[],
  favorites: ReadonlySet<string>,
): { favorite: ModelEntry[]; rest: ModelEntry[] } {
  const favorite: ModelEntry[] = [];
  const rest: ModelEntry[] = [];
  for (const entry of entries) {
    (favorites.has(entry.value) ? favorite : rest).push(entry);
  }
  return { favorite, rest };
}

export function getProviderStateEntries(
  providers: RuntimeModelPickerProvider[],
): ProviderStateEntry[] {
  return providers.flatMap((provider) => {
    if (!provider.disabled && provider.models.length > 0) return [];
    const statusLabel = getProviderStatusLabel(provider);
    return [
      {
        providerId: provider.id,
        providerLabel: provider.label,
        statusLabel,
        value: `${provider.id}:state`,
        keywords: [provider.label, provider.id, statusLabel],
      },
    ];
  });
}

function getProviderStatusLabel(provider: RuntimeModelPickerProvider): string {
  if (!provider.disabled) return "No models available";
  if (provider.status === "unavailable") return provider.statusMessage ?? "Unavailable";
  return "Coming soon";
}

export function SelectionGroup({ action, onSelect }: SelectionGroupProps): React.ReactElement {
  return (
    <CommandGroup heading="Selection">
      <CommandItem
        value={action.id}
        keywords={action.keywords}
        onSelect={onSelect}
        className="flex items-start gap-2 text-xs"
      >
        <CheckIcon
          className={cn("mt-0.5 size-3 shrink-0", action.selected ? "opacity-100" : "opacity-0")}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-foreground">{action.label}</span>
          {action.description ? (
            <span className="truncate text-[11px] text-muted-foreground">{action.description}</span>
          ) : null}
        </span>
      </CommandItem>
    </CommandGroup>
  );
}

export function ModelGroup({
  heading,
  entries,
  selectedModelValue,
  favorites,
  onSelect,
  onToggleFavorite,
}: ModelGroupProps): React.ReactElement {
  return (
    <CommandGroup heading={heading}>
      {entries.map((entry) => (
        <ModelItem
          key={entry.value}
          entry={entry}
          isSelected={entry.value === selectedModelValue}
          isFavorite={favorites.has(entry.value)}
          onSelect={onSelect}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </CommandGroup>
  );
}

function ModelItem({
  entry,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: ModelItemProps): React.ReactElement {
  return (
    <CommandItem
      value={entry.value}
      keywords={entry.keywords}
      onSelect={() => onSelect(entry)}
      className="group/model flex items-start justify-between gap-2 text-xs"
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
            <span className="truncate text-[11px] text-muted-foreground">{entry.description}</span>
          ) : null}
        </span>
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
        <FavoriteToggle
          isFavorite={isFavorite}
          modelLabel={`${entry.providerLabel} / ${entry.modelLabel}`}
          onToggle={() => onToggleFavorite(entry.value)}
        />
        <CheckIcon
          className={cn(
            "size-3 shrink-0 text-violet-400",
            isSelected ? "opacity-100" : "opacity-0",
          )}
        />
      </span>
    </CommandItem>
  );
}

function FavoriteToggle({
  isFavorite,
  modelLabel,
  onToggle,
}: FavoriteToggleProps): React.ReactElement {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={isFavorite}
      // Keep focus in the search input and stop cmdk from treating the click
      // as a selection of the row.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "size-4 shrink-0 p-0",
        isFavorite
          ? "text-[var(--acc-yellow)]"
          : "text-muted-foreground opacity-0 group-hover/model:opacity-100 group-data-[selected=true]/model:opacity-100",
      )}
    >
      <StarIcon className={cn("size-3", isFavorite && "fill-current")} />
      <span className="sr-only">{`${isFavorite ? "Unstar" : "Star"} ${modelLabel}`}</span>
    </Button>
  );
}

export function ProviderStateGroup({ entries }: ProviderStateGroupProps): React.ReactElement {
  return (
    <CommandGroup heading="Providers">
      {entries.map((entry) => (
        <CommandItem
          key={entry.value}
          value={entry.value}
          keywords={entry.keywords}
          disabled
          className="flex items-start gap-2 text-xs"
        >
          <LockIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-muted-foreground">{entry.providerLabel}</span>
            <span className="truncate text-[11px] text-muted-foreground">{entry.statusLabel}</span>
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
