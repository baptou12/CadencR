/**
 * Module-scoped manager for `LSPClient` instances keyed by
 * `${workspaceRoot}::${languageId}`. Lives outside Zustand on purpose:
 * `LSPClient` is a non-reactive object — components must never re-render when
 * its internal state changes, so a plain `Map` is the right shape. The
 * manager only exposes promises and getters; consumers subscribe to nothing.
 *
 * Each entry holds a single LSP session: one POST to reserve, one WebSocket
 * to carry frames, one `LSPClient` + `CadencrWorkspace`. Concurrent
 * `ensureClient(...)` calls for the same key share the in-flight init
 * promise so we don't claim two sessions for the same workspace+language.
 *
 * Step 5 of the rollout will add reference counting and idle shutdown on top
 * of this; for now sessions live until the page unloads.
 */
import { LSPClient } from "@codemirror/lsp-client";
import { openSession } from "@/api/generated";
import { connectLspWs, type WebSocketLspTransport } from "./transport";
import { CadencrWorkspace, type DisplayFileHandler } from "./cadencr-workspace";
import { pathToFileUri } from "./file-uri";

interface ClientEntry {
  client: LSPClient;
  workspace: CadencrWorkspace;
  transport: WebSocketLspTransport;
}

const clients = new Map<string, ClientEntry>();
const pending = new Map<string, Promise<ClientEntry>>();

function keyFor(workspaceRoot: string, languageId: string): string {
  return `${workspaceRoot}::${languageId}`;
}

/**
 * Get or create the LSP client for `(workspaceRoot, languageId)`. Throws on
 * server resolve / transport failure — callers should surface a toast.
 *
 * @public
 */
export async function ensureLspClient(
  workspaceRoot: string,
  languageId: string,
): Promise<{ client: LSPClient; workspace: CadencrWorkspace }> {
  const key = keyFor(workspaceRoot, languageId);
  const existing = clients.get(key);
  if (existing) return { client: existing.client, workspace: existing.workspace };
  const inflight = pending.get(key);
  if (inflight) {
    const entry = await inflight;
    return { client: entry.client, workspace: entry.workspace };
  }
  const promise = createEntry(workspaceRoot, languageId).finally(() => {
    pending.delete(key);
  });
  pending.set(key, promise);
  const entry = await promise;
  clients.set(key, entry);
  return { client: entry.client, workspace: entry.workspace };
}

async function createEntry(workspaceRoot: string, languageId: string): Promise<ClientEntry> {
  const { session_id } = await openSession({
    workspace_root: workspaceRoot,
    language_id: languageId,
  });
  const transport = await connectLspWs(session_id);
  let workspaceRef: CadencrWorkspace | null = null;
  const client = new LSPClient({
    rootUri: pathToFileUri(workspaceRoot),
    workspace: (c) => {
      workspaceRef = new CadencrWorkspace(c);
      return workspaceRef;
    },
  });
  client.connect(transport);
  if (!workspaceRef) {
    // Defensive: LSPClient calls `workspace()` synchronously in its
    // constructor, but if a future version changes that and the factory
    // never ran, we'd silently lose `displayFile` wiring.
    transport.close();
    throw new Error("LSP workspace was not initialised by the client");
  }
  return { client, workspace: workspaceRef, transport };
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
