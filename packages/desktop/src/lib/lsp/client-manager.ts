/**
 * Module-scoped manager for `LSPClient` instances keyed by
 * `${workspaceRoot}::${languageId}`. Lives outside Zustand on purpose:
 * `LSPClient` is a non-reactive object — components must never re-render when
 * its internal state changes, so a plain `Map` is the right shape. The
 * manager only exposes promises and getters; consumers subscribe to nothing.
 *
 * Each entry holds a single LSP session: one POST to reserve, one WebSocket
 * to carry frames, one `LSPClient` + `CadencrWorkspace`. Concurrent
 * `acquireLspClient(...)` calls for the same key share the in-flight init
 * promise so we don't claim two sessions for the same workspace+language.
 *
 * Lifecycle: `useLsp` calls [`acquireLspClient`] on mount, [`releaseLspClient`]
 * on unmount. When the refcount drops to zero we arm a grace-period timer
 * (so flipping between tabs doesn't tear the server down) and only then
 * disconnect. A re-acquire inside the grace period cancels the shutdown.
 */
import { LSPClient } from "@codemirror/lsp-client";
import { openSession } from "@/api/generated";
import { connectLspWs, type WebSocketLspTransport } from "./transport";
import { CadencrWorkspace, type DisplayFileHandler } from "./cadencr-workspace";
import { pathToFileUri } from "./file-uri";
import { buildLspNotificationHandlers } from "./notifications";
import { cadencrServerDiagnostics } from "./diagnostics";

interface ClientEntry {
  client: LSPClient;
  workspace: CadencrWorkspace;
  transport: WebSocketLspTransport;
  refCount: number;
  shutdownTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * How long an unused client lingers before we disconnect. Long enough to
 * absorb tab-switches and re-renders that briefly drop the refcount to
 * zero; short enough that a closed file doesn't keep its language server
 * resident for the rest of the session.
 */
const SHUTDOWN_GRACE_MS = 30_000;

const clients = new Map<string, ClientEntry>();
const pending = new Map<string, Promise<ClientEntry>>();

function keyFor(workspaceRoot: string, languageId: string): string {
  return `${workspaceRoot}::${languageId}`;
}

/**
 * Acquire a refcounted LSP client for `(workspaceRoot, languageId)`. Bumps
 * the refcount and cancels any pending shutdown timer. Pair every call
 * with [`releaseLspClient`] on cleanup. Throws on server resolve /
 * transport failure — callers should surface a toast.
 *
 * @public
 */
export async function acquireLspClient(
  workspaceRoot: string,
  languageId: string,
): Promise<{ client: LSPClient; workspace: CadencrWorkspace }> {
  const key = keyFor(workspaceRoot, languageId);
  const existing = clients.get(key);
  if (existing) {
    existing.refCount += 1;
    if (existing.shutdownTimer != null) {
      clearTimeout(existing.shutdownTimer);
      existing.shutdownTimer = null;
    }
    return { client: existing.client, workspace: existing.workspace };
  }
  const inflight = pending.get(key);
  if (inflight) {
    const entry = await inflight;
    entry.refCount += 1;
    return { client: entry.client, workspace: entry.workspace };
  }
  const promise = createEntry(workspaceRoot, languageId).finally(() => {
    pending.delete(key);
  });
  pending.set(key, promise);
  const entry = await promise;
  entry.refCount += 1;
  clients.set(key, entry);
  return { client: entry.client, workspace: entry.workspace };
}

/**
 * Decrement the refcount for `(workspaceRoot, languageId)`. When it
 * reaches zero we arm a grace timer; the entry stays alive (and warm) for
 * `SHUTDOWN_GRACE_MS` so a quick re-acquire avoids a respawn.
 *
 * @public
 */
export function releaseLspClient(workspaceRoot: string, languageId: string): void {
  const key = keyFor(workspaceRoot, languageId);
  const entry = clients.get(key);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;
  if (entry.shutdownTimer != null) clearTimeout(entry.shutdownTimer);
  entry.shutdownTimer = setTimeout(() => {
    // Re-check in case a late re-acquire bumped the count back up.
    const current = clients.get(key);
    if (!current || current.refCount > 0) return;
    current.client.disconnect();
    current.transport.close();
    clients.delete(key);
  }, SHUTDOWN_GRACE_MS);
}

async function createEntry(workspaceRoot: string, languageId: string): Promise<ClientEntry> {
  const session = await openSession({
    workspace_root: workspaceRoot,
    language_id: languageId,
  }).catch((err: unknown) => {
    // Axios wraps the body inside `err.response.data.error`. Surface the
    // backend's install hint verbatim rather than swallow it as a bare
    // "Request failed with status 404".
    const axiosErr = err as { response?: { data?: { error?: string } } };
    const detail = axiosErr?.response?.data?.error;
    throw new Error(detail ?? (err instanceof Error ? err.message : "Failed to open LSP session"));
  });
  const transport = await connectLspWs(session.session_id);
  let workspaceRef: CadencrWorkspace | null = null;
  const client = new LSPClient({
    rootUri: pathToFileUri(workspaceRoot),
    workspace: (c) => {
      workspaceRef = new CadencrWorkspace(c);
      return workspaceRef;
    },
    // Route `window/showMessage` and `window/logMessage` to sonner
    // toasts instead of the library's default in-buffer banner.
    notificationHandlers: buildLspNotificationHandlers(),
    // Wires `publishDiagnostics` into `@codemirror/lint` underlines + hover
    // tooltips, and also installs the doc-change autoSync — without it the
    // server would only ever see the file's initial contents.
    extensions: [cadencrServerDiagnostics()],
  });
  client.connect(transport);
  if (!workspaceRef) {
    // Defensive: LSPClient calls `workspace()` synchronously in its
    // constructor, but if a future version changes that and the factory
    // never ran, we'd silently lose `displayFile` wiring.
    transport.close();
    throw new Error("LSP workspace was not initialised by the client");
  }
  return { client, workspace: workspaceRef, transport, refCount: 0, shutdownTimer: null };
}

/**
 * Register a host-provided `displayFile` handler with the workspace for
 * `(workspaceRoot, languageId)`. The handler bridges LSP-driven navigation
 * into Cadencr's tab system. Returns an unregister function.
 *
 * @public
 */
export function setDisplayFileHandler(
  workspaceRoot: string,
  languageId: string,
  handler: DisplayFileHandler,
): () => void {
  const entry = clients.get(keyFor(workspaceRoot, languageId));
  if (!entry) return () => {};
  entry.workspace.setDisplayFileHandler(handler);
  return () => {
    // Only clear if no other handler has replaced ours in the meantime.
    entry.workspace.setDisplayFileHandler(null);
  };
}

/** Test-only: tear down every cached client. */
/** @public */
export function __resetLspClientsForTest(): void {
  for (const entry of clients.values()) {
    entry.client.disconnect();
    entry.transport.close();
  }
  clients.clear();
  pending.clear();
}
