/**
 * Agent type definitions for frontend components.
 */

export type AgentType =
  | "plan"
  | "prd"
  | "execute"
  | "risk"
  | "review"
  | "session"
  | "qa"
  | "review-fixer"
  | "retro"
  | "auto_name"
  | (string & {}); // Custom workflow phase slugs (e.g. "specify", "analyze")

/** Image payload sent with prompts to agents. */
interface ImagePayload {
  base64: string;
  mimeType: string;
}

interface ParsedUserMessageImage {
  mediaType: string;
  data: string;
}

interface ParsedUserMessageContent {
  text: string;
  images: ParsedUserMessageImage[];
}

/** Build the `content` string for a user_message block (plain text or JSON with images). */
export function buildUserMessageContent(text: string, images?: ImagePayload[]): string {
  if (!images || images.length === 0) return text;
  return JSON.stringify([
    { type: "text", text },
    ...images.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.base64 },
    })),
  ]);
}

export function parseUserMessageContent(content: string): ParsedUserMessageContent {
  if (!content.startsWith("[")) return { text: content, images: [] };

  try {
    const parsed = JSON.parse(content) as Array<{
      type: string;
      text?: string;
      source?: { media_type?: string; data?: string };
    }>;
    if (!Array.isArray(parsed)) {
      return { text: content, images: [] };
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

    return { text, images };
  } catch {
    return { text: content, images: [] };
  }
}

/** Extract only the text portion from a persisted user_message block. */
export function extractUserMessageText(content: string): string {
  return parseUserMessageContent(content).text;
}
