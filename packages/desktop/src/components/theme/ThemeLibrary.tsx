import { useCallback, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { UserTheme } from "@/api/generated";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useTheme } from "@/hooks/useTheme";
import { useUserThemes } from "@/hooks/useUserThemes";
import type { ThemeDefinition } from "@/lib/themes";
import { userThemeId, userThemeLabel } from "@/lib/themes/user-theme";
import { ThemeBasePicker } from "./ThemeBasePicker";
import { ThemeStudio } from "./ThemeStudioDialog";
import { UserThemeCard } from "./UserThemeCard";
import { useThemeLibraryActions } from "./useThemeLibraryActions";

/**
 * The theme library: every theme the user has made, and the one control that
 * makes another.
 *
 * Creating and editing are the same act here — a new theme is a copy of an
 * existing one, opened straight into the studio, where the JSON and an agent
 * that can rewrite it sit side by side.
 */
export function ThemeLibrary(): React.JSX.Element {
  const { entries, enabledThemes, isLoading, isEnabled, setEnabled, error } = useUserThemes();
  const { themeId } = useTheme();
  const actions = useThemeLibraryActions();
  const editing = useThemeEditing(entries);
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<UserTheme | null>(null);

  const createFrom = useCallback(
    (base: ThemeDefinition): void => {
      actions.duplicate(base, (created) => {
        setPicking(false);
        editing.open(created);
      });
    },
    [actions, editing],
  );

  return (
    <div className="space-y-4">
      <Button size="sm" className="gap-1.5" onClick={() => setPicking(true)}>
        <Plus className="size-3.5" />
        Create theme
      </Button>

      {error ? (
        <p className="text-xs text-[var(--acc-red)]">Could not load your themes: {error.message}</p>
      ) : null}

      {isLoading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" aria-hidden />
          Loading themes…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No themes yet. Create one from any theme you already like — you get its complete, working
          set of colors to change.
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <UserThemeCard
              key={entry.id}
              theme={entry}
              isActive={themeId === userThemeId(entry.id)}
              isEnabled={isEnabled(entry.id)}
              isDeleting={actions.deletingId === entry.id}
              onToggleEnabled={(enabled) => setEnabled(entry.id, enabled)}
              onEdit={() => editing.open(entry)}
              onExport={() => actions.exportTheme(entry)}
              onDelete={() => setDeleting(entry)}
            />
          ))}
        </div>
      )}

      {picking ? (
        <ThemeBasePicker
          userThemes={enabledThemes}
          isCreating={actions.isDuplicating}
          onPick={createFrom}
          onClose={() => setPicking(false)}
        />
      ) : null}

      {editing.theme ? <ThemeStudio theme={editing.theme} onClose={editing.close} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete “${userThemeLabel(deleting)}”?` : ""}
        description="The theme file and the conversation you edited it in are removed. Export it first if you want to keep a copy."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleting && actions.remove(deleting)}
      />
    </div>
  );
}

/**
 * Which theme the studio is open on.
 *
 * Tracked by *id* and re-read from the list on every render, so that when the
 * agent rewrites the file — and the watcher refetches — the open studio sees
 * the new content. Holding the entry itself would freeze it at open time. The
 * entry passed to `open` is only a stand-in for the beat before a freshly
 * created theme appears in the list.
 */
function useThemeEditing(entries: UserTheme[]): {
  theme: UserTheme | null;
  open: (theme: UserTheme) => void;
  close: () => void;
} {
  const [pending, setPending] = useState<UserTheme | null>(null);
  const open = useCallback((theme: UserTheme): void => setPending(theme), []);
  const close = useCallback((): void => setPending(null), []);
  const theme = pending ? (entries.find((entry) => entry.id === pending.id) ?? pending) : null;
  return { theme, open, close };
}
