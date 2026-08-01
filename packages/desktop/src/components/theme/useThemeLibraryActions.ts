import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCreateTheme, useDeleteTheme, type UserTheme } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { invalidateThemes } from "@/lib/themeInvalidation";
import { downloadJsonFile } from "@/lib/download";
import type { ThemeDefinition } from "@/lib/themes";
import { readThemeCssVars, userThemeLabel } from "@/lib/themes/user-theme";

interface ThemeLibraryActions {
  /** Copy `source` into a new theme; `onCreated` receives it once it exists. */
  duplicate: (source: ThemeDefinition, onCreated?: (created: UserTheme) => void) => void;
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
 */
export function useThemeLibraryActions(): ThemeLibraryActions {
  const queryClient = useQueryClient();
  const create = useCreateTheme();
  const remove = useDeleteTheme();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    void invalidateThemes(queryClient);
  }, [queryClient]);

  const duplicate = useCallback(
    (source: ThemeDefinition, onCreated?: (created: UserTheme) => void): void => {
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
            label: `${source.label} (copy)`,
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
            refresh();
            toast.success(`Deleted “${userThemeLabel(theme)}”`);
          },
          onError: (error) => toast.error(apiErrorMessage(error, "Failed to delete theme")),
          onSettled: () => setDeletingId(null),
        },
      );
    },
    [remove, refresh],
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
