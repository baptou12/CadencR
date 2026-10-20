import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { getGetWorkspaceSettingQueryKey, type SettingValueResponse } from "@/api/generated";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { parseJsonSetting } from "@/lib/json-setting";

/** Workspace settings holding the sidebar's expansion memory, each a JSON array of ids. */
export const SIDEBAR_EXPANDED_PROJECTS_KEY = "sidebar_expanded_projects";
export const SIDEBAR_COLLAPSED_SUBTREES_KEY = "sidebar_collapsed_subtrees";
export const SIDEBAR_ARCHIVED_OPEN_PROJECTS_KEY = "sidebar_archived_open_projects";

const idListSchema = z.array(z.number().int());

type ParsedIdList = { ids: number[]; error: string | null };

export function parseIdList(raw: string | null | undefined): ParsedIdList {
  const { value, error } = parseJsonSetting(raw, idListSchema, "expected an array of ids");
  return { ids: value ?? [], error };
}

/** Says once that a stored id list is corrupt: it reads as empty until the next write replaces it. */
export function useIdListError(key: string, error: string | null): void {
  useEffect(() => {
    if (error) {
      toast.error(`Could not read setting "${key}": ${error}. Your next change will replace it.`, {
        id: `setting-${key}`,
      });
    }
  }, [key, error]);
}

/**
 * The stored ids as of now, read from the cache rather than a render closure
 * so two writes in one tick compose. Null, with a toast, while the setting
 * hasn't loaded: writing then would replace the stored list.
 */
export function readLoadedIdList(queryClient: QueryClient, key: string): number[] | null {
  const cached = queryClient.getQueryData<SettingValueResponse>(
    getGetWorkspaceSettingQueryKey(key),
  );
  if (cached === undefined) {
    toast.error(`Could not save setting "${key}": it has not loaded yet.`, {
      id: `setting-${key}`,
    });
    return null;
  }
  return parseIdList(cached.value).ids;
}

export interface PersistedIdSet {
  ids: ReadonlySet<number>;
  setMember: (id: number, member: boolean) => void;
}

/**
 * A set of numeric ids persisted as a JSON array in one workspace setting, so
 * it survives reloads and follows the user across desktop and remote clients.
 * Every hook on the same key shares the query cache, so toggles compose. Writes
 * go out immediately: a debounce timer would die with the component (collapsing
 * a project unmounts its rows) and drop the write.
 */
export function usePersistedIdSet(key: string): PersistedIdSet {
  const setting = useDebouncedSetting(key, 0);
  const queryClient = useQueryClient();
  const parsed = useMemo(() => parseIdList(setting.value), [setting.value]);
  const ids = useMemo(() => new Set(parsed.ids), [parsed]);

  useIdListError(key, parsed.error);

  const { setValue } = setting;
  const setMember = useCallback(
    (id: number, member: boolean): void => {
      const stored = readLoadedIdList(queryClient, key);
      if (!stored) return;
      const next = new Set(stored);
      if (next.has(id) === member) return;
      if (member) next.add(id);
      else next.delete(id);
      setValue(JSON.stringify([...next].sort((a, b) => a - b)));
    },
    [key, queryClient, setValue],
  );

  return useMemo(() => ({ ids, setMember }), [ids, setMember]);
}
