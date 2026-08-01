import type { ThemeDocument } from "@/api/generated";
import { THEME_TOKEN_KEYS } from "./tokens";

/**
 * Reading a theme document out of editor text.
 *
 * The authority on whether a theme is valid is the backend — it parses every
 * color, checks contrast pairs and resolves `var()` chains. This is the much
 * narrower question the *preview* has to answer on every keystroke: is this
 * buffer complete enough to paint the app with, right now?
 *
 * It is deliberately structural only. Anything that gets past it is still
 * filtered value-by-value on injection (`isSafeTokenValue`) and re-validated
 * server-side on save, so a draft that slips through paints imperfectly at
 * worst — it can never inject CSS or become an applied theme.
 */

/** The xterm palette keys, mirrored from the backend's `XtermPalette`. */
const XTERM_KEYS = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
  "selectionInactiveBackground",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first missing or non-string key of `required`, if any. */
function firstMissing(source: Record<string, unknown>, required: readonly string[]): string | null {
  return required.find((key) => typeof source[key] !== "string" || source[key] === "") ?? null;
}

/**
 * Parse editor text into a theme document, or throw with a message meant to be
 * shown to the user inline.
 */
export function parseThemeDocument(content: string): ThemeDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "invalid JSON");
  }
  if (!isRecord(parsed)) throw new Error("a theme must be a JSON object");
  if (typeof parsed.label !== "string" || parsed.label.trim() === "") {
    throw new Error("`label` must be a non-empty string");
  }
  if (parsed.appearance !== "light" && parsed.appearance !== "dark") {
    throw new Error('`appearance` must be "light" or "dark"');
  }
  if (!isRecord(parsed.cssVars)) throw new Error("`cssVars` must be an object");
  const missingToken = firstMissing(parsed.cssVars, THEME_TOKEN_KEYS);
  if (missingToken) throw new Error(`\`cssVars\` is missing ${missingToken}`);
  if (!isRecord(parsed.xterm)) throw new Error("`xterm` must be an object");
  const missingXterm = firstMissing(parsed.xterm, XTERM_KEYS);
  if (missingXterm) throw new Error(`\`xterm\` is missing ${missingXterm}`);
  return parsed as unknown as ThemeDocument;
}

/** Replace the document's name, preserving the rest of the file's formatting
 *  as closely as a re-serialization can. */
export function withLabel(document: ThemeDocument, label: string): ThemeDocument {
  return { ...document, label };
}

/** Serialize back to the file's on-disk shape: pretty-printed, newline-ended,
 *  matching what the backend writes so a round-trip produces no diff. */
export function serializeThemeDocument(document: ThemeDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
