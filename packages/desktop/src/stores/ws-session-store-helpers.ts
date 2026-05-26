import type { SessionEntry } from "./ws-session-types";
import type { WsEnvelope } from "@/lib/ws-envelope";
import { createModeSet, createPromptSend } from "@/lib/ws-envelope";
import type { QueuedPrompt } from "./ws-session-types";
import { blocksPatchWithDerived } from "./ws-block-mutations";
import type { LocalUserMessageOptions } from "./ws-pending-prompts";
import { movePendingPromptBlocksToTail } from "./ws-pending-prompts";
import type { AgentBlockData } from "@/components/AgentBlock";
export { buildSlashCommandsKey } from "@/lib/slash-command-key";

/**
 * Build an inline error block (rendered by `ErrorBlock`). Increments the
 * session's block counter to keep IDs unique. Caller is responsible for
 * appending the block to `session.blocks` and any additional patch (e.g.
 * lifecycle transitions, `removePendingPromptBlocks`, etc.).
 */
export function makeErrorBlock(
  session: SessionEntry,
  content: string,
  options: { code?: string; idPrefix?: string } = {},
): AgentBlockData {
  session.streamingState.counter += 1;
  return {
    id: `${options.idPrefix ?? "ws-err"}-${session.streamingState.counter}`,
    type: "error",
    content,
    ...(options.code ? { errorCode: options.code } : {}),
  };
}

export function appendLocalUserMessage(
  session: SessionEntry,
  content: string,
  options: LocalUserMessageOptions = {},
): Pick<SessionEntry, "blocks" | "rootBlocks" | "toolResultMap"> {
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
