/**
 * Agent type definitions for frontend components.
 */

import type { PromptAttachmentKind } from "@/lib/prompt-attachments";

export type AgentType = "session" | "auto_name";

/** File payload sent with prompts to agents. */
export interface PromptAttachmentPayload {
  base64: string;
  fileName: string;
  kind: PromptAttachmentKind;
  mimeType: string;
}

export interface ParsedPromptAttachment {
  base64?: string;
  fileName: string;
  kind: PromptAttachmentKind;
  mimeType: string;
}

interface ParsedUserMessageImage {
  mediaType: string;
  data: string;
}

interface ParsedUserMessageContent {
  text: string;
  images: ParsedUserMessageImage[];
  attachments: ParsedPromptAttachment[];
}

type UserMessageContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    }
  | {
      type: "attachment";
      file_name: string;
      kind: PromptAttachmentKind;
      media_type: string;
      data?: string;
    };

/** Build the `content` string for a user_message block (plain text or JSON with attachments). */
export function buildUserMessageContent(
  text: string,
  attachments?: PromptAttachmentPayload[],
): string {
  if (!attachments || attachments.length === 0) return text;
  const blocks: UserMessageContentBlock[] = text.length > 0 ? [{ type: "text", text }] : [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: attachment.mimeType, data: attachment.base64 },
      });
      continue;
    }
    blocks.push({
      type: "attachment",
      file_name: attachment.fileName,
      kind: attachment.kind,
      media_type: attachment.mimeType,
      data: attachment.base64,
    });
  }
  return JSON.stringify(blocks);
}

export function parseUserMessageContent(content: string): ParsedUserMessageContent {
  if (!content.startsWith("[")) return { text: content, images: [], attachments: [] };

  try {
    const parsed = JSON.parse(content) as Array<{
      type: string;
      text?: string;
      file_name?: string;
      kind?: string;
      media_type?: string;
      data?: string;
      source?: { media_type?: string; data?: string };
    }>;
    if (!Array.isArray(parsed)) {
      return { text: content, images: [], attachments: [] };
    }

    const text = parsed
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text ?? "")
      .join("\n");
    const images = parsed.flatMap((block) => {
      if (
        block.type !== "image" ||
        typeof block.source?.media_type !== "string" ||
        typeof block.source.data !== "string"
      ) {
        return [];
      }

      return [{ mediaType: block.source.media_type, data: block.source.data }];
    });
    const attachments = parsed.flatMap((block) => {
      if (
        block.type !== "attachment" ||
        typeof block.file_name !== "string" ||
        !isPromptAttachmentKind(block.kind) ||
        typeof block.media_type !== "string"
      ) {
        return [];
      }
      return [
        {
          ...(typeof block.data === "string" ? { base64: block.data } : {}),
          fileName: block.file_name,
          kind: block.kind,
          mimeType: block.media_type,
        },
      ];
    });

    return { text, images, attachments };
  } catch {
    return { text: content, images: [], attachments: [] };
  }
}

function isPromptAttachmentKind(kind: unknown): kind is PromptAttachmentKind {
  return (
    kind === "image" ||
    kind === "document" ||
    kind === "text" ||
    kind === "audio" ||
    kind === "resource"
  );
}

/** Extract only the text portion from a persisted user_message block. */
export function extractUserMessageText(content: string): string {
  return parseUserMessageContent(content).text;
}
