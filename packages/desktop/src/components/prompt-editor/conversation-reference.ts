export interface ConversationReferenceData {
  featureId: number;
  label: string;
}

const REFERENCE_PATTERN = /\[@@([^\r\n]*?)\]\(cadencr-conversation:feature\/([0-9]+)\)/g;
const REFERENCE_HREF_PATTERN = /^cadencr-conversation:feature\/([0-9]+)$/;

export interface ParsedConversationReference extends ConversationReferenceData {
  start: number;
  end: number;
}

function sanitizeLabel(label: string): string {
  return label
    .replaceAll("\\", " ")
    .replaceAll("[", " ")
    .replaceAll("]", " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function serializeConversationReference(reference: ConversationReferenceData): string {
  const label = sanitizeLabel(reference.label) || `Conversation ${reference.featureId}`;
  return `[@@${label}](${conversationReferenceHref(reference.featureId)})`;
}

export function conversationReferenceHref(featureId: number): string {
  return `cadencr-conversation:feature/${featureId}`;
}

export function parseConversationReferenceHref(href: string): number | null {
  const match = REFERENCE_HREF_PATTERN.exec(href);
  if (!match) return null;
  const featureId = Number(match[1]);
  return Number.isSafeInteger(featureId) && featureId > 0 ? featureId : null;
}

export function parseConversationReferences(text: string): ParsedConversationReference[] {
  const references: ParsedConversationReference[] = [];
  for (const match of text.matchAll(REFERENCE_PATTERN)) {
    const featureId = Number(match[2]);
    if (!Number.isSafeInteger(featureId) || featureId <= 0 || match.index == null) continue;
    references.push({
      featureId,
      label: match[1],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return references;
}
