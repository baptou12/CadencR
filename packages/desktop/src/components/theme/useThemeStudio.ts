import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useWriteTheme, type UserTheme } from "@/api/generated";
import { apiErrorMessage } from "@/lib/api-errors";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { invalidateThemes } from "@/lib/themeInvalidation";
import { parseThemeDocument, serializeThemeDocument, withLabel } from "@/lib/themes/draft";
import { applyThemePreview, clearThemePreview } from "@/lib/themes/preview";
import { userThemeLabel } from "@/lib/themes/user-theme";

/**
 * The editing session behind the theme studio.
 *
 * Three things write to one theme file here: the user's buffer, the agent, and
 * the Cancel button. The rules that keep them coherent:
 *
 *  - The file on disk is the truth. The agent edits it directly, and the
 *    backend's watcher pushes every change back, so the buffer follows disk
 *    whenever the user has nothing unsaved. When they *do*, the buffer wins and
 *    the incoming change is surfaced as a conflict rather than typed over.
 *  - Nothing the user types reaches disk before Save. Until then the app is
 *    painted from the buffer by the preview layer, which is what makes an edit
 *    visible without making it real.
 *  - Cancel restores the file to what it was when the studio opened — including
 *    anything the agent wrote in between, which is the only way "cancel" can
 *    mean anything once a second writer is involved.
 */

const PREVIEW_DEBOUNCE_MS = 150;

export interface ThemeStudioState {
  content: string;
  setContent: (content: string) => void;
  /** Bumped when the buffer is replaced from disk, to re-seed the editor. */
  editorKey: number;
  name: string;
  setName: (name: string) => void;
  /** Why the draft can't be previewed, if it can't. */
  previewError: string | null;
  isDirty: boolean;
  /** The agent changed the file while the user had unsaved edits. */
  conflict: boolean;
  adoptFromDisk: () => void;
  save: () => void;
  cancel: () => void;
  isBusy: boolean;
}

export function useThemeStudio(theme: UserTheme, onClose: () => void): ThemeStudioState {
  const queryClient = useQueryClient();
  const write = useWriteTheme();
  // Captured once: what Cancel puts back. `theme` is refetched on every file
  // change, so reading it later would snapshot the agent's work instead.
  const snapshotRef = useRef(theme.content);
  const [content, setContent] = useState(theme.content);
  const [name, setName] = useState(() => userThemeLabel(theme));
  const [editorKey, setEditorKey] = useState(0);
  const [conflict, setConflict] = useState(false);
  const serverContentRef = useRef(theme.content);
  const isDirty = content !== serverContentRef.current;

  const adopt = useCallback((next: string, nextName: string): void => {
    serverContentRef.current = next;
    setContent(next);
    setName(nextName);
    setEditorKey((key) => key + 1);
    setConflict(false);
  }, []);

  // The agent wrote the file (or the user did, in their own editor).
  useEffect(() => {
    if (theme.content === serverContentRef.current) return;
    if (content === serverContentRef.current) adopt(theme.content, userThemeLabel(theme));
    else setConflict(true);
  }, [adopt, content, theme]);

  const adoptFromDisk = useCallback(
    (): void => adopt(theme.content, userThemeLabel(theme)),
    [adopt, theme],
  );

  const effectiveContent = useEffectiveContent(content, name);
  usePreview(effectiveContent.content);

  const refresh = useCallback((): void => void invalidateThemes(queryClient), [queryClient]);

  const writeContent = useCallback(
    (next: string, done: (saved: UserTheme) => void): void => {
      write.mutate(
        { id: theme.id, data: { content: next } },
        {
          onSuccess: (response) => {
            serverContentRef.current = next;
            refresh();
            done(response.theme);
          },
          onError: (error) => toast.error(apiErrorMessage(error, "Failed to save theme")),
        },
      );
    },
    [refresh, theme.id, write],
  );

  const save = useCallback((): void => {
    writeContent(effectiveContent.content, (saved) => {
      // Issues don't block the save — the user may be halfway through an edit —
      // but they do mean the theme won't paint, so they can't pass silently.
      const issue = saved.issues[0];
      if (issue) {
        const detail = issue.token ? `${issue.token}: ${issue.message}` : issue.message;
        toast.warning(`Saved, but not applied — ${detail}`);
      } else {
        toast.success(`Saved “${name}”`);
      }
      onClose();
    });
  }, [effectiveContent.content, name, onClose, writeContent]);

  const cancel = useCallback((): void => {
    if (serverContentRef.current === snapshotRef.current) {
      onClose();
      return;
    }
    // The file only differs because it was written while the studio was open —
    // by the agent, or by a save. Undoing that is the point of Cancel, but it
    // is a real write to a real file, so say so.
    writeContent(snapshotRef.current, () => {
      toast.info("Theme restored to how it was when you opened it");
      onClose();
    });
  }, [onClose, writeContent]);

  return useMemo(
    () => ({
      content,
      setContent,
      editorKey,
      name,
      setName,
      previewError: effectiveContent.error,
      isDirty,
      conflict,
      adoptFromDisk,
      save,
      cancel,
      isBusy: write.isPending,
    }),
    [
      adoptFromDisk,
      cancel,
      conflict,
      content,
      editorKey,
      effectiveContent.error,
      isDirty,
      name,
      save,
      write.isPending,
    ],
  );
}

/**
 * The text that would be written right now: the buffer, with the name field
 * folded in. Renaming reserializes — the only edit that reformats the file —
 * so a buffer whose name is untouched is saved back byte for byte.
 */
function useEffectiveContent(
  content: string,
  name: string,
): { content: string; error: string | null } {
  return useMemo(() => {
    try {
      const document_ = parseThemeDocument(content);
      const trimmed = name.trim();
      if (trimmed === "" || trimmed === document_.label) return { content, error: null };
      return { content: serializeThemeDocument(withLabel(document_, trimmed)), error: null };
    } catch (error) {
      // An unparseable buffer is still saveable — the backend stores it and
      // reports the issues — it just can't be previewed or renamed.
      return { content, error: error instanceof Error ? error.message : String(error) };
    }
  }, [content, name]);
}

/** Paint the app from the draft, and put it back on close. */
function usePreview(content: string): void {
  const debounced = useDebouncedValue(content, PREVIEW_DEBOUNCE_MS);
  useEffect(() => {
    try {
      applyThemePreview(parseThemeDocument(debounced));
    } catch {
      // Mid-edit text is expected to be unparseable; the last good preview
      // stays on screen and `previewError` explains why it stopped updating.
    }
  }, [debounced]);
  useEffect(() => clearThemePreview, []);
}
