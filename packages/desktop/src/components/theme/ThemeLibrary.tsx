import { lazy, Suspense, useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useWriteTheme, type UserTheme } from "@/api/generated";
import type { BuiltInThemeId } from "@/lib/themes";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsJsonDialogShell } from "@/components/settings/SettingsJsonDialogShell";
import { useTheme } from "@/hooks/useTheme";
import { useUserThemes } from "@/hooks/useUserThemes";
import { getTheme, THEME_LIST } from "@/lib/themes";
import { userThemeId, userThemeLabel } from "@/lib/themes/user-theme";
import { invalidateThemes } from "@/lib/themeInvalidation";
import { UserThemeCard } from "./UserThemeCard";
import { useThemeLibraryActions } from "./useThemeLibraryActions";

const SettingsJsonEditorDialog = lazy(
  () => import("@/components/settings/SettingsJsonEditorDialog"),
);

/**
 * The theme library: every theme the user has made, alongside the one control
 * that creates them.
 *
 * There is deliberately no visual token editor. A theme is a JSON file of
 * design tokens; duplicating a working theme and editing that file — in here or
 * in your own editor, with the result live either way — is the whole v1.
 */
export function ThemeLibrary(): React.JSX.Element {
  const { entries, isLoading, isEnabled, setEnabled, error } = useUserThemes();
  const { themeId } = useTheme();
  const actions = useThemeLibraryActions();
  const [sourceId, setSourceId] = useState<BuiltInThemeId>(THEME_LIST[0].id as BuiltInThemeId);
  const [editing, setEditing] = useState<UserTheme | null>(null);
  const [deleting, setDeleting] = useState<UserTheme | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sourceId} onValueChange={(id) => setSourceId(id as BuiltInThemeId)}>
          <SelectTrigger size="sm" className="w-56">
            <SelectValue placeholder="Choose a theme to copy" />
          </SelectTrigger>
          <SelectContent>
            {THEME_LIST.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          className="gap-1.5"
          disabled={actions.isDuplicating}
          onClick={() => actions.duplicate(getTheme(sourceId))}
        >
          {actions.isDuplicating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Copy className="size-3.5" />
          )}
          Duplicate
        </Button>
      </div>

      {error ? (
        <p className="text-xs text-[var(--acc-red)]">Could not load your themes: {error.message}</p>
      ) : null}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading themes…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No themes yet. Duplicate one above to get a complete, working token set you can edit.
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
              onEdit={() => setEditing(entry)}
              onExport={() => actions.exportTheme(entry)}
              onDelete={() => setDeleting(entry)}
            />
          ))}
        </div>
      )}

      {editing ? <ThemeJsonEditor theme={editing} onClose={() => setEditing(null)} /> : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete “${userThemeLabel(deleting)}”?` : ""}
        description="The theme file is removed from disk. Export it first if you want to keep a copy."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => deleting && actions.remove(deleting)}
      />
    </div>
  );
}

/**
 * Edit a theme's file in-app. Saving writes the file, which the backend watcher
 * picks up — so the same live-reload path serves both this editor and the
 * user's own.
 */
function ThemeJsonEditor({
  theme,
  onClose,
}: {
  theme: UserTheme;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const write = useWriteTheme();
  const title = `Theme — ${userThemeLabel(theme)}`;

  return (
    <Suspense
      fallback={
        <SettingsJsonDialogShell title={title} path={theme.path} onOpenChange={onClose}>
          <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" aria-label="Loading editor" />
          </div>
        </SettingsJsonDialogShell>
      }
    >
      <SettingsJsonEditorDialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={title}
        entityLabel="Theme"
        path={theme.path}
        initialContent={theme.content}
        isSaving={write.isPending}
        // The file is written whatever it contains; the returned issues say
        // whether it can be applied. Reporting them as warnings keeps a
        // half-finished edit saveable while making it obvious it isn't live.
        onSave={async (content) => {
          const response = await write.mutateAsync({ id: theme.id, data: { content } });
          return response.theme.issues.map((issue) => ({
            key: issue.token ?? "",
            message: issue.token ? `${issue.token}: ${issue.message}` : issue.message,
          }));
        }}
        onSaved={() => void invalidateThemes(queryClient)}
      />
    </Suspense>
  );
}
