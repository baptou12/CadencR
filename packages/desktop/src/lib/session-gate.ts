import type { AgentMessageOrigin } from "@/api/generated";
import {
  decodeXmlAttribute,
  matchesGeneratedSessionOrigin,
  optionalPositiveInteger,
  parseSessionEnvelope,
  positiveInteger,
} from "@/lib/session-envelope";

export type SessionGateKind = "permission" | "question" | "plan";

export interface SessionGateEnvelope {
  childSessionId: number;
  childFeatureId: number;
  childFeatureTitle?: string;
  childProjectId?: number;
  kind: SessionGateKind;
  requestId: string;
  payload: unknown;
}

export function parseGeneratedSessionGate(
  content: string,
  origin: AgentMessageOrigin | null | undefined,
): SessionGateEnvelope | null {
  const envelope = parseSessionEnvelope(content, "cadencr-gate");
  if (!envelope) return null;
  const attrs = envelope.attributes;
  const childSessionId = positiveInteger(attrs["from-session"]);
  const childFeatureId = positiveInteger(attrs["from-feature"]);
  const childFeatureTitle = decodeXmlAttribute(attrs["from-feature-title"]);
  const childProjectId = optionalPositiveInteger(attrs["from-project"]);
  const kind = attrs.kind;
  if (
    childSessionId === null ||
    childFeatureId === null ||
    !isKind(kind) ||
    !attrs["request-id"] ||
    !matchesGeneratedSessionOrigin(origin, childSessionId, childFeatureId, childProjectId)
  )
    return null;
  try {
    const payload: unknown = JSON.parse(envelope.body);
    return {
      childSessionId,
      childFeatureId,
      childFeatureTitle,
      childProjectId,
      kind: normalizeGateKind(kind, payload),
      requestId: decodeXmlAttribute(attrs["request-id"]) ?? attrs["request-id"],
      payload,
    };
  } catch {
    return null;
  }
}

/**
 * Aligns with backend `GateKind::from_pending`: AskUserQuestion → question,
 * ExitPlanMode → plan. Used for MCP gate envelopes and the sidebar pending-gate API.
 */
export function normalizeGateKind(kind: string, payload: unknown): SessionGateKind {
  const toolName =
    payload !== null &&
    typeof payload === "object" &&
    "tool_name" in payload &&
    typeof payload.tool_name === "string"
      ? payload.tool_name
      : "";
  if (toolName === "ExitPlanMode") return "plan";
  if (toolName === "AskUserQuestion") return "question";
  if (isKind(kind)) return kind;
  return "permission";
}

function isKind(value: string | undefined): value is SessionGateKind {
  return value === "permission" || value === "question" || value === "plan";
}
