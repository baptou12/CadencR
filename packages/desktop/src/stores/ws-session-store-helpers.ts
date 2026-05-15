import type { SessionEntry } from "./ws-session-types";
import type { WsEnvelope } from "@/lib/ws-envelope";
import { createModeSet, createPromptSend } from "@/lib/ws-envelope";
import type { QueuedPrompt } from "./ws-session-types";
import { transitionTurn } from "./ws-turn-lifecycle";
import { blocksPatchWithDerived } from "./ws-block-mutations";
import type { LocalUserMessageOptions } from "./ws-pending-prompts";
import { movePendingPromptBlocksToTail } from "./ws-pending-prompts";
export { buildSlashCommandsKey } from "@/lib/slash-command-key";

export function appendLocalUserMessage(
  session: SessionEntry,
  content: string,
  options: LocalUserMessageOptions = {},
): Pick<SessionEntry, "blocks" | "rootBlocks" | "toolResultMap" | "lifecycle"> {
  session.streamingState.counter += 1;
  const block = {
    id: `ws-user-${session.streamingState.counter}`,
    type: "user_message" as const,
    content,
    isError: false,
    createdAt: new Date().toISOString(),
    ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}),
    ...(options.promptDeliveryState ? { promptDeliveryState: options.promptDeliveryState } : {}),
  };
  const blocks = movePendingPromptBlocksToTail([...session.blocks, block]);
  return {
    ...blocksPatchWithDerived(session.streamingState, blocks),
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
      createPromptSend(session.serverSessionId, prompt.text, prompt.images, prompt.useWorktree),
    );
  }
  return envelopes;
}
