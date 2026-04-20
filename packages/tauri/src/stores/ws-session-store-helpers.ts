import type { SessionEntry } from "./ws-session-types";
import type { WsEnvelope } from "@/lib/ws-envelope";
import { createModeSet, createPromptSend } from "@/lib/ws-envelope";
import type { QueuedPrompt } from "./ws-session-types";
import { transitionTurn } from "./ws-turn-lifecycle";

export function buildSlashCommandsKey(cwd: string, provider?: string): string {
  return `${provider ?? ""}::${cwd}`;
}

export function appendLocalUserMessage(
  session: SessionEntry,
  content: string,
): Pick<SessionEntry, "blocks" | "lifecycle"> {
  session.streamingState.counter += 1;
  return {
    blocks: [
      ...session.blocks,
      {
        id: `ws-user-${session.streamingState.counter}`,
        type: "user_message" as const,
        content,
        isError: false,
        createdAt: new Date().toISOString(),
      },
    ],
    lifecycle: transitionTurn(session.lifecycle, { type: "prompt_sent" }),
  };
}

export function buildQueuedPromptPatch(
  session: SessionEntry,
  text: string,
  images?: Array<{ base64: string; mimeType: string }>,
  useWorktree?: boolean,
): Pick<SessionEntry, "queuedPrompts"> {
  const queuedPrompt: QueuedPrompt = { text };
  if (images && images.length > 0) queuedPrompt.images = images;
  if (useWorktree) queuedPrompt.useWorktree = true;
  return {
    queuedPrompts: [...session.queuedPrompts, queuedPrompt],
  };
}

export function buildQueuedInitEnvelopes(session: SessionEntry): WsEnvelope[] {
  if (!session.serverSessionId) return [];

  const envelopes: WsEnvelope[] = [];
  if (session.permissionMode === "plan") {
    envelopes.push(createModeSet(session.serverSessionId, "plan"));
  }
  for (const prompt of session.queuedPrompts) {
    envelopes.push(
      createPromptSend(
        session.serverSessionId,
        prompt.text,
        prompt.images,
        prompt.useWorktree,
      ),
    );
  }
  return envelopes;
}
