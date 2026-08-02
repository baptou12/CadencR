import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getListThemesQueryKey,
  useCreateTheme,
  useDeleteTheme,
  type UserTheme,
} from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { downloadJsonFile } from "@/lib/download";
import type { ThemeDefinition } from "@/lib/themes";
import { readThemeCssVars, userThemeLabel } from "@/lib/themes/user-theme";
import { useReleaseTheme } from "./useReleaseTheme";

interface ThemeLibraryActions {
  /**
   * Copy `source` into a new theme called `label`; `onCreated` receives it once
   * it exists.
   */
  duplicate: (
    source: ThemeDefinition,
    label: string,
    onCreated?: (created: UserTheme) => void,
  ) => void;
  remove: (theme: UserTheme) => void;
  exportTheme: (theme: UserTheme) => void;
  isDuplicating: boolean;
  /** The theme currently being deleted, so only its own button goes busy. */
  deletingId: string | null;
}

/**
 * Create / delete / export for the theme library.
 *
 * Duplication is the only way to create a theme, on purpose: it seeds the
 * complete, already-valid token set of a working theme, so the user always
 * edits from something that renders rather than assembling 104 tokens by hand.
 * The copy is made server-side before the studio opens, because the agent that
 * edits it alongside the user needs a real folder to work in.
 *
 * What it is *called* comes from the user, not from the source: the label picks
 * the id, the folder and the project name, all of which are awkward to change
 * afterwards.
 */
export function useThemeLibraryActions(): ThemeLibraryActions {
  const queryClient = useQueryClient();
  const create = useCreateTheme();
  const remove = useDeleteTheme();
  const release = useReleaseTheme();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Only the theme list. Both paths below deal with the project a theme owns
  // themselves — a create has none yet (the workspace endpoint makes it, and
  // refreshes the sidebar), and a delete sweeps it explicitly.
  const refresh = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: getListThemesQueryKey() });
  }, [queryClient]);

  const duplicate = useCallback(
    (source: ThemeDefinition, label: string, onCreated?: (created: UserTheme) => void): void => {
      let cssVars;
      try {
        cssVars = readThemeCssVars(source.id, source.cssVars);
      } catch (error) {
        toast.error(apiErrorMessage(error, "Failed to read the source theme"));
        return;
      }
      create.mutate(
        {
          data: {
            label,
            appearance: source.appearance,
            cssVars,
            xterm: source.xterm,
          },
        },
        {
          onSuccess: (created) => {
            refresh();
            toast.success(`Created “${userThemeLabel(created)}”`);
            onCreated?.(created);
          },
          onError: (error) => toast.error(apiErrorMessage(error, "Failed to duplicate theme")),
        },
      );
    },
    [create, refresh],
  );

  const removeTheme = useCallback(
    (theme: UserTheme): void => {
      setDeletingId(theme.id);
      remove.mutate(
        { id: theme.id },
        {
          onSuccess: () => {
            // Nothing can wear it now, and a selection left pointing at it
            // would silently resolve to the default — or come back to life if
            // a new theme ever landed on the same id.
            release(theme);
            refresh();
            // The theme's project went with it, so the sidebar is now showing a
            // project that no longer exists.
            void invalidateByUrlPrefix(queryClient, ["/api/projects", "/api/features"]);
            toast.success(`Deleted “${userThemeLabel(theme)}” — it's in the Trash`);
          },
          onError: (error) => toast.error(apiErrorMessage(error, "Failed to delete theme")),
          onSettled: () => setDeletingId(null),
        },
      );
    },
    [remove, refresh, release, queryClient],
  );

  const exportTheme = useCallback((theme: UserTheme): void => {
    // Export is the whole sharing story for now: a theme file is portable data,
    // so "share" is "send someone this file".
    downloadJsonFile(`${theme.id}.theme.json`, theme.content);
  }, []);

  return useMemo(
    () => ({
      duplicate,
      remove: removeTheme,
      exportTheme,
      isDuplicating: create.isPending,
      deletingId,
    }),
    [duplicate, removeTheme, exportTheme, create.isPending, deletingId],
  );
}
