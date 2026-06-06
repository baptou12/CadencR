/**
 * Byte sequences for terminal keys that a touch keyboard can't produce on its
 * own. Used by the mobile terminal key bar and the PTY input path so phones can
 * send Esc, Tab, arrows, and Ctrl-combinations.
 */
export const TERMINAL_KEYS = {
  esc: "\x1b",
  tab: "\t",
  arrowUp: "\x1b[A",
  arrowDown: "\x1b[B",
  arrowRight: "\x1b[C",
  arrowLeft: "\x1b[D",
} as const;

/**
 * Convert a single printable character into its Ctrl-modified control byte
 * (e.g. "c" -> "\x03", the SIGINT that kills a running process). Returns null
 * when the character has no control form, so callers can send it verbatim.
 */
export function toControlChar(ch: string): string | null {
  if (ch.length !== 1) return null;
  // @ A-Z [ \ ] ^ _  map to control codes 0x00–0x1f (char code minus 64).
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  return null;
}
