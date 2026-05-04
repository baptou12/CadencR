import { useCallback, useEffect, useState } from "react";
import type { UnifiedAgentsMode } from "@/api/generated";
import type { UnifiedAgentsFilterMode } from "@/components/UnifiedAgentsFilters";

const FILTER_EVENT = "cadencr:unified-agents-filters-changed";

const FILTER_KEYS = {
  mode: "unified_agents_mode",
  freshMinutes: "unified_agents_fresh_minutes",
  agentsPerRow: "unified_agents_per_row",
  projectId: "unified_agents_project_id",
  query: "unified_agents_query",
} as const;

const FRESH_MINUTES_MIN = 1;
const FRESH_MINUTES_MAX = 240;
const DEFAULT_FRESH_MINUTES = 5;
const AGENTS_PER_ROW_MIN = 1;
const AGENTS_PER_ROW_MAX = 6;
const DEFAULT_AGENTS_PER_ROW = 3;

export interface PersistedUnifiedAgentsFilters {
  mode: UnifiedAgentsFilterMode;
  freshMinutes: number;
  agentsPerRow: number;
  projectId: number | null;
  query: string;
}

export function readUnifiedAgentsFilters(): PersistedUnifiedAgentsFilters {
  return {
    mode: readMode(),
    freshMinutes: readBoundedInt(
      FILTER_KEYS.freshMinutes,
      DEFAULT_FRESH_MINUTES,
      FRESH_MINUTES_MIN,
      FRESH_MINUTES_MAX,
    ),
    agentsPerRow: readBoundedInt(
      FILTER_KEYS.agentsPerRow,
      DEFAULT_AGENTS_PER_ROW,
      AGENTS_PER_ROW_MIN,
      AGENTS_PER_ROW_MAX,
    ),
    projectId: readNullableInt(FILTER_KEYS.projectId),
    query: window.localStorage.getItem(FILTER_KEYS.query) ?? "",
  };
}

export function useUnifiedAgentsFilterValue<K extends keyof PersistedUnifiedAgentsFilters>(
  key: K,
): [PersistedUnifiedAgentsFilters[K], (value: PersistedUnifiedAgentsFilters[K]) => void] {
  const [value, setValue] = useState<PersistedUnifiedAgentsFilters[K]>(
    () => readUnifiedAgentsFilters()[key],
  );
  useEffect(() => subscribeFilters(() => setValue(readUnifiedAgentsFilters()[key])), [key]);
  const update = useCallback(
    (nextValue: PersistedUnifiedAgentsFilters[K]): void => {
      writeFilterValue(key, nextValue);
      setValue(nextValue);
    },
    [key],
  );
  return [value, update];
}

export function usePersistedUnifiedAgentsFilters(): PersistedUnifiedAgentsFilters {
  const [filters, setFilters] = useState(readUnifiedAgentsFilters);
  useEffect(() => subscribeFilters(() => setFilters(readUnifiedAgentsFilters())), []);
  return filters;
}

export function toUnifiedAgentsQueryParams(
  filters: Pick<PersistedUnifiedAgentsFilters, "mode" | "freshMinutes">,
  messageLimit: number,
): {
  mode: UnifiedAgentsMode;
  fresh_minutes?: number;
  include_archived: boolean;
  message_limit: number;
} {
  return {
    mode: filters.mode as UnifiedAgentsMode,
    fresh_minutes: filters.mode === "recent" ? filters.freshMinutes : undefined,
    include_archived: false,
    message_limit: messageLimit,
  };
}

function writeFilterValue<K extends keyof PersistedUnifiedAgentsFilters>(
  key: K,
  value: PersistedUnifiedAgentsFilters[K],
): void {
  if (value === null) window.localStorage.removeItem(FILTER_KEYS[key]);
  else window.localStorage.setItem(FILTER_KEYS[key], String(value));
  window.dispatchEvent(new CustomEvent(FILTER_EVENT));
}

function subscribeFilters(callback: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key && !Object.values(FILTER_KEYS).includes(event.key as never)) return;
    callback();
  };
  window.addEventListener(FILTER_EVENT, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(FILTER_EVENT, callback);
    window.removeEventListener("storage", onStorage);
  };
}

function readMode(): UnifiedAgentsFilterMode {
  const value = window.localStorage.getItem(FILTER_KEYS.mode);
  return value === "all" ? "all" : "recent";
}

function readBoundedInt(key: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(window.localStorage.getItem(key) ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readNullableInt(key: string): number | null {
  const stored = window.localStorage.getItem(key);
  if (!stored) return null;
  const parsed = Number.parseInt(stored, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
