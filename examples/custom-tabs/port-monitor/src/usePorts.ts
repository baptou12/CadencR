import { useCallback, useEffect, useRef, useState } from "react";
import { toCadencrError, type CadencrError } from "@cadencr/tab-sdk";
import { useCadencr, useVisibility } from "@cadencr/tab-sdk/react";
import { z } from "zod";

/** One process listening on one port, as `backend/server.mjs` reports it. */
const portEntrySchema = z.object({
  port: z.number().int(),
  pid: z.number().int(),
  command: z.string(),
  user: z.string().nullable(),
  /** `null` where the platform cannot tell (Windows). */
  cwd: z.string().nullable(),
  addresses: z.array(z.string()),
  /**
   * Running in this conversation's folder; `null` when unknown. Conversations
   * that share a folder (no worktree of their own) share these processes too.
   */
  inFolder: z.boolean().nullable(),
});
export type PortEntry = z.infer<typeof portEntrySchema>;

const portsSchema = z.object({ ports: z.array(portEntrySchema), checkedAt: z.string() });

const conversationSchema = z.object({ title: z.string(), worktree: z.string(), platform: z.string() });
export type Conversation = z.infer<typeof conversationSchema>;

export type PortsState =
  | { status: "loading" }
  | { status: "error"; error: CadencrError }
  | { status: "ready"; ports: PortEntry[]; checkedAt: string };

/** The backend's answers are JSON nothing has checked yet: parse before rendering. */
function parseReply<T>(schema: z.ZodType<T>, method: string, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`The backend answered \`${method}\` with an unexpected shape.`);
  return parsed.data;
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
      const result = parseReply(portsSchema, "ports", await client.backend.request("ports"));
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
      .then((value) => setConversation(parseReply(conversationSchema, "context", value)))
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
