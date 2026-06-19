/**
 * `useLsp` is the single React entry point for plugging an editor into the
 * LSP layer. It:
 *
 * 1. Maps the file extension to an LSP `languageId` (returns no extensions
 *    for unsupported files — cmd-click is a no-op there).
 * 2. Resolves the monorepo-aware LSP root for the opened file (nearest
 *    ancestor config), falling back to the feature root.
 * 3. Lazily ensures an `LSPClient` exists for `(resolvedRoot, languageId)`.
 * 4. Registers a `displayFile` handler so cross-file LSP navigation lands
 *    in the same `(featureId, paneId)` the user clicked from.
 * 5. Returns the CodeMirror extensions the editor should mount + an
 *    observable `status` for the status-bar indicator.
 *
 * The extension array is `[]` while the client is being created, then a
 * stable array once ready, so callers can feed the result into a
 * `Compartment` and reconfigure without remount. When the underlying socket
 * dies and the manager reconnects, the extension array gets a fresh identity
 * so the editor re-mounts the LSP compartment onto the new client.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { keymap, type EditorView } from "@codemirror/view";
import { type Extension } from "@codemirror/state";
import { renameKeymap, serverCompletion, type LSPClient } from "@codemirror/lsp-client";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { getLspLanguageId } from "./language-id";
import { pathToFileUri } from "./file-uri";
import {
  acquireLspClient,
  releaseLspClient,
  subscribeLspStatus,
  getLspStatus,
  getLspClient,
  retryLspClient,
} from "./client-manager";
import { resolveLspRoot } from "./resolve-root";
import { lspModClickExtension } from "./mod-click";
import { lspModHoverExtension } from "./mod-hover";
import { jumpToDefinitionKeymap } from "./definition";
import { type CadencrWorkspace } from "./cadencr-workspace";

interface UseLspArgs {
  workspaceRoot: string | undefined;
  filePath: string;
  featureId: number;
  paneId: string;
  /**
   * When false, acquire no client and return an empty extension array + an
   * idle status. Used by large-file read-only mode. Defaults to true.
   */
  enabled?: boolean;
}

/**
 * Coarse LSP state for the editor status bar.
 *
 * - `unsupported`: no language server is registered for this file's
 *   extension — cmd-click and hover are no-ops.
 * - `starting`: session reserved / WebSocket negotiating / server booting.
 * - `ready`: client + workspace are live; LSP requests succeed.
 * - `reconnecting`: the socket died unexpectedly and the manager is
 *   rebuilding the session with backoff. Cmd-click is briefly a no-op.
 * - `error`: session-open or transport failure (or reconnect gave up);
 *   `errorMessage` carries the backend-supplied install hint or transport
 *   error verbatim. Clicking the indicator forces a retry.
 */
export type LspStatus = "unsupported" | "starting" | "ready" | "reconnecting" | "error";

export interface UseLspResult {
  /** CodeMirror extension to mount inside a Compartment. `[]` until ready. */
  extension: Extension;
  /** Coarse state for status-bar / popover display. */
  status: LspStatus;
  /** Present iff `status === "error"`. */
  errorMessage?: string;
  /** Resolved LSP language id (e.g. `"typescript"`), or `null` if unsupported. */
  languageId: string | null;
  /** Monorepo-resolved LSP root, or `null` while resolving / unsupported. */
  resolvedRoot: string | null;
  /** Force a fresh connection attempt. No-op unless a session exists. Wire
   * to `EditorStatusBar`'s `onLspRetry` so the error indicator can retry. */
  onRetry: () => void;
}

/** @public */
export function useLsp({
  workspaceRoot,
  filePath,
  featureId,
  paneId,
  enabled = true,
}: UseLspArgs): UseLspResult {
  const [ready, setReady] = useState<{ client: LSPClient; workspace: CadencrWorkspace } | null>(
    null,
  );
  const [resolvedRoot, setResolvedRoot] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Bumped on every manager status transition so we re-read the live client
  // (its identity changes after a reconnect) and re-derive status.
  const [statusTick, setStatusTick] = useState(0);
  // When disabled, behave exactly like an unsupported file: no language id,
  // no client acquisition, empty extension array, idle status.
  const languageId = useMemo(
    () => (enabled ? getLspLanguageId(filePath) : null),
    [enabled, filePath],
  );

  const absPath = useMemo(() => {
    if (!workspaceRoot) return null;
    return filePath.startsWith("/") ? filePath : `${workspaceRoot.replace(/\/$/, "")}/${filePath}`;
  }, [workspaceRoot, filePath]);

  // Step 1: resolve the monorepo-aware LSP root for this file. Falls back to
  // the feature root on any failure (single-package repos resolve here too).
  useEffect(() => {
    if (!workspaceRoot || !languageId || !absPath) {
      setResolvedRoot(null);
      return;
    }
    let cancelled = false;
    void resolveLspRoot(workspaceRoot, languageId, absPath).then((root) => {
      if (!cancelled) setResolvedRoot(root);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceRoot, languageId, absPath]);

  // Step 2: acquire a refcounted client keyed by (resolvedRoot, languageId).
  // We always release on cleanup, even on error / unmount-before-resolve, so
  // the refcount stays balanced — the manager's grace timer keeps the WS
  // warm if the user re-mounts quickly.
  useEffect(() => {
    setErrorMessage(null);
    if (!resolvedRoot || !languageId) {
      setReady(null);
      return;
    }
    let cancelled = false;
    let acquiredKey: { root: string; languageId: string } | null = null;
    acquireLspClient(resolvedRoot, languageId)
      .then((entry) => {
        acquiredKey = { root: resolvedRoot, languageId };
        if (cancelled) {
          releaseLspClient(resolvedRoot, languageId);
          return;
        }
        setReady(entry);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Failed to start language server";
        toast.error(msg);
        setErrorMessage(msg);
      });
    return () => {
      cancelled = true;
      if (acquiredKey) releaseLspClient(acquiredKey.root, acquiredKey.languageId);
    };
  }, [resolvedRoot, languageId]);

  // Step 3: subscribe to manager status so reconnects re-bind the client and
  // surface the reconnecting/error states in the status bar.
  useEffect(() => {
    if (!resolvedRoot || !languageId) return;
    const onChange = (): void => {
      // Re-read the live client (reconnect swaps its identity) and bump the
      // tick so the extension memo re-runs.
      const live = getLspClient(resolvedRoot, languageId);
      if (live) setReady(live);
      setStatusTick((t) => t + 1);
    };
    return subscribeLspStatus(resolvedRoot, languageId, onChange);
  }, [resolvedRoot, languageId]);

  // Step 4: register the displayFile handler so jumpToDefinition lands in the
  // same pane the click came from.
  useEffect(() => {
    if (!ready) return;
    const handler = async (absTarget: string): Promise<EditorView | null> => {
      useEditorStore.getState().openFile(featureId, paneId, absTarget);
      return null;
    };
    ready.workspace.setDisplayFileHandler(handler);
    return () => {
      ready.workspace.setDisplayFileHandler(null);
    };
  }, [ready, featureId, paneId]);

  // Step 5: derive status from inputs + manager state. The manager status (if
  // present) wins once a client exists, so reconnect/error are reflected live.
  const status: LspStatus = useMemo(() => {
    void statusTick;
    if (!languageId) return "unsupported";
    if (errorMessage) return "error";
    if (resolvedRoot) {
      const snapshot = getLspStatus(resolvedRoot, languageId);
      if (snapshot) {
        if (snapshot.status === "error") return "error";
        if (snapshot.status === "reconnecting") return "reconnecting";
        if (snapshot.status === "ready") return "ready";
      }
    }
    return ready ? "ready" : "starting";
  }, [languageId, errorMessage, resolvedRoot, ready, statusTick]);

  const managerError = useMemo(() => {
    void statusTick;
    if (!resolvedRoot || !languageId) return null;
    return getLspStatus(resolvedRoot, languageId)?.errorMessage ?? null;
  }, [resolvedRoot, languageId, statusTick]);

  // Step 6: build the extension list. Stable reference for the "not ready"
  // case so React.memo'd parents don't re-render every tick. `ready` identity
  // changes after a reconnect, forcing a fresh extension so the editor
  // re-mounts the compartment onto the new client.
  const extension = useMemo<Extension>(() => {
    if (!ready || !resolvedRoot || !languageId || !absPath) return [];
    const uri = pathToFileUri(absPath);
    return [
      ready.client.plugin(uri, languageId),
      serverCompletion(),
      keymap.of([...jumpToDefinitionKeymap, ...renameKeymap]),
      lspModClickExtension({ resolvedRoot, languageId }),
      lspModHoverExtension(),
    ];
  }, [ready, resolvedRoot, languageId, absPath]);

  const onRetry = useCallback(() => {
    if (resolvedRoot && languageId) retryLspClient(resolvedRoot, languageId);
  }, [resolvedRoot, languageId]);

  return useMemo<UseLspResult>(
    () => ({
      extension,
      status,
      errorMessage: errorMessage ?? managerError ?? undefined,
      languageId,
      resolvedRoot,
      onRetry,
    }),
    [extension, status, errorMessage, managerError, languageId, resolvedRoot, onRetry],
  );
}
