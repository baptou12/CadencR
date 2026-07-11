import type { AgentMessageOrigin } from "@/api/generated";
import {
  decodeXmlAttribute,
  matchesGeneratedSessionOrigin,
  optionalPositiveInteger,
  parseSessionEnvelope,
  positiveInteger,
} from "@/lib/session-envelope";

export type SessionGateKind = "permission" | "question" | "plan";
export type SessionGateAutonomy = "human_only" | "parent_may_answer" | "parent_answers_all";

export interface SessionGateEnvelope {
  childSessionId: number;
  childFeatureId: number;
  childFeatureTitle?: string;
  childProjectId?: number;
  kind: SessionGateKind;
  requestId: string;
  autonomy: SessionGateAutonomy;
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
  const autonomy = attrs.autonomy;
  if (
    childSessionId === null ||
    childFeatureId === null ||
    !isKind(kind) ||
    !isAutonomy(autonomy) ||
    !attrs["request-id"] ||
    !matchesGeneratedSessionOrigin(origin, childSessionId, childFeatureId, childProjectId)
  )
    return null;
  try {
    return {
      childSessionId,
      childFeatureId,
      childFeatureTitle,
      childProjectId,
      kind,
      requestId: decodeXmlAttribute(attrs["request-id"]) ?? attrs["request-id"],
      autonomy,
      payload: JSON.parse(envelope.body),
    };
  } catch {
    return null;
  }
}

function isKind(value: string | undefined): value is SessionGateKind {
  return value === "permission" || value === "question" || value === "plan";
}

function isAutonomy(value: string | undefined): value is SessionGateAutonomy {
  return value === "human_only" || value === "parent_may_answer" || value === "parent_answers_all";
}
