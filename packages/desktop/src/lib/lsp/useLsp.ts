/**
 * `useLsp` is the single React entry point for plugging an editor into the
 * LSP layer. It:
 *
 * 1. Maps the file extension to an LSP `languageId` (returns no extensions
 *    for unsupported files — cmd-click is a no-op there).
 * 2. Lazily ensures an `LSPClient` exists for `(workspaceRoot, languageId)`.
 * 3. Registers a `displayFile` handler so cross-file LSP navigation lands
 *    in the same `(featureId, paneId)` the user clicked from.
 * 4. Returns the CodeMirror extensions the editor should mount: the LSP
 *    plugin (for `didOpen` / `didChange`), the F12 keymap, and the
 *    cmd-click handler.
 *
 * Returns an empty array while the client is still being created, then a
 * stable array once ready. The caller is expected to feed the result into a
 * `Compartment` so the editor can pick up the LSP wiring without remount.
 */
import { useEffect, useMemo, useState } from "react";
import { keymap, type EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { jumpToDefinitionKeymap, type LSPClient } from "@codemirror/lsp-client";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { getLspLanguageId } from "./language-id";
import { pathToFileUri } from "./file-uri";
import { acquireLspClient, releaseLspClient } from "./client-manager";
import { lspModClickExtension } from "./mod-click";
import { lspModHoverExtension } from "./mod-hover";
import { type CadencrWorkspace } from "./cadencr-workspace";

interface UseLspArgs {
  workspaceRoot: string | undefined;
  filePath: string;
  featureId: number;
  paneId: string;
}

/** @public */
export function useLsp({ workspaceRoot, filePath, featureId, paneId }: UseLspArgs): Extension {
  const [ready, setReady] = useState<{ client: LSPClient; workspace: CadencrWorkspace } | null>(
    null,
  );
  const languageId = useMemo(() => getLspLanguageId(filePath), [filePath]);

  // Step 1: acquire a refcounted client. Re-run when the workspace root or
  // language changes (i.e. the user opened a file in a different language).
  // We always release on cleanup, even on error / unmount-before-resolve,
  // so the refcount stays balanced — the client-manager's grace timer
  // keeps the WS warm if the user re-mounts quickly.
  useEffect(() => {
    if (!workspaceRoot || !languageId) {
      setReady(null);
      return;
    }
    let cancelled = false;
    let acquiredKey: { workspaceRoot: string; languageId: string } | null = null;
    acquireLspClient(workspaceRoot, languageId)
      .then((entry) => {
        acquiredKey = { workspaceRoot, languageId };
        if (cancelled) {
          // Lost the race against unmount; release immediately so the
          // grace timer can run instead of leaking a refcount.
          releaseLspClient(workspaceRoot, languageId);
          return;
        }
        setReady(entry);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to start language server";
        toast.error(msg);
      });
    return () => {
      cancelled = true;
      if (acquiredKey) {
        releaseLspClient(acquiredKey.workspaceRoot, acquiredKey.languageId);
      }
    };
  }, [workspaceRoot, languageId]);

  // Step 2: register the displayFile handler so jumpToDefinition lands in
  // the same pane the click came from. The workspace is shared across
  // editors of the same language, so the handler points at *this* pane only
  // while this editor is mounted.
  useEffect(() => {
    if (!ready) return;
    const handler = async (absPath: string): Promise<EditorView | null> => {
      // The store mutation is synchronous; the new editor for this tab will
      // mount asynchronously (Suspense). The workspace's `openFile` callback
      // will resolve the pending wait once that view appears.
      useEditorStore.getState().openFile(featureId, paneId, absPath);
      return null;
    };
    ready.workspace.setDisplayFileHandler(handler);
    return () => {
      // Only clear if we're still the active handler — another editor may
      // have replaced us already (e.g. user switched panes mid-navigation).
      ready.workspace.setDisplayFileHandler(null);
    };
  }, [ready, featureId, paneId]);

  // Step 3: build the extension list. Returns a stable reference for the
  // "not ready" case so React.memo'd parents don't re-render every tick.
  return useMemo<Extension>(() => {
    if (!ready || !workspaceRoot || !languageId) return [];
    const absPath = filePath.startsWith("/")
      ? filePath
      : `${workspaceRoot.replace(/\/$/, "")}/${filePath}`;
    const uri = pathToFileUri(absPath);
    return [
      ready.client.plugin(uri, languageId),
      keymap.of(jumpToDefinitionKeymap),
      lspModClickExtension(),
      lspModHoverExtension(),
    ];
  }, [ready, workspaceRoot, languageId, filePath]);
}
