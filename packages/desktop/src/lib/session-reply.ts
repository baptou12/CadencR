import type { AgentMessageOrigin } from "@/api/generated";

export type SessionReplyStatus = "completed" | "failed";
export type SessionReplyLink = "spawned" | "messaged";

export interface SessionReplyEnvelope {
  responderSessionId: number;
  responderFeatureId: number;
  responderFeatureTitle?: string;
  responderProjectId?: number;
  requestMessageId?: number;
  status: SessionReplyStatus;
  link: SessionReplyLink;
  body: string;
}

const ENVELOPE_PATTERN = /^<cadencr-reply\s+([^>]+)>\r?\n?([\s\S]*?)\r?\n?<\/cadencr-reply>\s*$/;
const ATTRIBUTE_PATTERN = /([a-z-]+)="([^"]*)"/g;

export function parseSessionReplyEnvelope(content: string): SessionReplyEnvelope | null {
  const match = ENVELOPE_PATTERN.exec(content.trim());
  if (!match) return null;
  const attributes = Object.fromEntries(
    Array.from(match[1].matchAll(ATTRIBUTE_PATTERN), ([, key, value]) => [key, value]),
  );
  const responderSessionId = positiveInteger(attributes["from-session"]);
  const responderFeatureId = positiveInteger(attributes["from-feature"]);
  const requestMessageId = optionalPositiveInteger(attributes["request-message-id"]);
  const responderFeatureTitle = decodeXmlAttribute(attributes["from-feature-title"]);
  const responderProjectId = optionalPositiveInteger(attributes["from-project"]);
  const status = attributes.status;
  const link = attributes.link;
  if (
    responderSessionId === null ||
    responderFeatureId === null ||
    (status !== "completed" && status !== "failed") ||
    (link !== "spawned" && link !== "messaged")
  ) {
    return null;
  }
  return {
    responderSessionId,
    responderFeatureId,
    responderFeatureTitle,
    responderProjectId,
    requestMessageId,
    status,
    link,
    body: match[2].trim(),
  };
}

export function parseGeneratedSessionReply(
  content: string,
  origin: AgentMessageOrigin | null | undefined,
): SessionReplyEnvelope | null {
  if (origin?.originKind !== "session_generated" || !origin.sourceSessionId) return null;
  const reply = parseSessionReplyEnvelope(content);
  if (!reply || reply.responderSessionId !== origin.sourceSessionId) return null;
  if (origin.sourceFeatureId && reply.responderFeatureId !== origin.sourceFeatureId) return null;
  if (origin.sourceProjectId && reply.responderProjectId !== origin.sourceProjectId) return null;
  return reply;
}

function decodeXmlAttribute(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return positiveInteger(value) ?? undefined;
}
