/** Normalize every accepted UUID spelling to the canonical lowercase form. */
export function normalizeMessageUuid(value: string): string {
  const trimmed = value.trim();
  const unwrapped =
    trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  return unwrapped.toLowerCase();
}
