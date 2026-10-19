import { useCallback, useEffect, useRef, useState } from "react";
import { toCadencrError, type CadencrError } from "@cadencr/tab-sdk";
import { useCadencr, useVisibility } from "@cadencr/tab-sdk/react";

/** One process listening on one port, as `backend/server.mjs` reports it. */
export interface PortEntry {
  port: number;
  pid: number;
  command: string;
  user: string | null;
  /** `null` where the platform cannot tell (Windows). */
  cwd: string | null;
  addresses: string[];
  /**
   * Running in this conversation's folder; `null` when unknown. Conversations
   * that share a folder (no worktree of their own) share these processes too.
   */
  inFolder: boolean | null;
}

export interface Conversation {
  title: string;
  worktree: string;
  platform: string;
}

export type PortsState =
  | { status: "loading" }
  | { status: "error"; error: CadencrError }
  | { status: "ready"; ports: PortEntry[]; checkedAt: string };

/**
 * The backend's answers are JSON nothing has checked yet: check the shape
 * before rendering it (by hand, to keep this example's dependencies to the SDK).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPortEntry(value: unknown): value is PortEntry {
  return (
    isRecord(value) &&
    typeof value.port === "number" &&
    typeof value.pid === "number" &&
    typeof value.command === "string" &&
    Array.isArray(value.addresses)
  );
}

function portsResult(value: unknown): { ports: PortEntry[]; checkedAt: string } {
  if (isRecord(value) && Array.isArray(value.ports) && value.ports.every(isPortEntry) && typeof value.checkedAt === "string") {
    return { ports: value.ports, checkedAt: value.checkedAt };
  }
  throw new Error("The backend answered `ports` with an unexpected shape.");
}

function conversationResult(value: unknown): Conversation {
  if (isRecord(value) && typeof value.title === "string" && typeof value.worktree === "string" && typeof value.platform === "string") {
    return { title: value.title, worktree: value.worktree, platform: value.platform };
  }
  throw new Error("The backend answered `context` with an unexpected shape.");
}

/** The backend runs `lsof` each time: often enough to feel live, not more. */
const POLL_MS = 5_000;

/**
 * The listening ports, polled from the tab's backend while the tab is shown.
 * The first call starts the backend (Cadencr launches `node backend/server.mjs`);
 * a backend that cannot start or crashes surfaces here as a `CadencrError`.
 */
export function usePorts() {
  const client = useCadencr();
  const visible = useVisibility();
  const [state, setState] = useState<PortsState>({ status: "loading" });
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversationLoading, setConversationLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const result = portsResult(await client.backend.request("ports"));
      setState({ status: "ready", ports: result.ports, checkedAt: result.checkedAt });
    } catch (error) {
      setState({ status: "error", error: toCadencrError(error) });
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    setConversationLoading(true);
    client.backend
      .request("context")
      .then((value) => setConversation(conversationResult(value)))
      .catch((error: unknown) =>
        void client.ui.toast({
          title: "Couldn't read the conversation",
          description: toCadencrError(error).message,
          variant: "error",
        }),
      )
      .finally(() => setConversationLoading(false));
  }, [client]);

  useEffect(() => {
    if (!visible) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [visible, load]);

  const stop = useCallback(
    async (entry: PortEntry) => {
      try {
        await client.backend.request("stop", { pid: entry.pid });
        await client.ui.toast({
          title: `Stopped ${entry.command}`,
          description: `Process ${entry.pid} on port ${entry.port}.`,
          variant: "success",
        });
      } catch (error) {
        await client.ui.toast({
          title: `Couldn't stop ${entry.command}`,
          description: toCadencrError(error).message,
          variant: "error",
        });
      }
      await load();
    },
    [client, load],
  );

  return { state, conversation, conversationLoading, refreshing, reload: load, stop };
}
