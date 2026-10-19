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
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const result = await client.backend.request<{ ports: PortEntry[]; checkedAt: string }>("ports");
      setState({ status: "ready", ports: result.ports, checkedAt: result.checkedAt });
    } catch (error) {
      setState({ status: "error", error: toCadencrError(error) });
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    client.backend
      .request<Conversation>("context")
      .then(setConversation)
      .catch((error: unknown) =>
        void client.ui.toast({
          title: "Couldn't read the conversation",
          description: toCadencrError(error).message,
          variant: "error",
        }),
      );
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

  return { state, conversation, refreshing, reload: load, stop };
}
