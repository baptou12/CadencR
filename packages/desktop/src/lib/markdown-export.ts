import { toast } from "sonner";

/** Supported clipboard export formats for markdown sources. */
export type ExportFormat = "markdown" | "plain" | "slack";

/**
 * Strip markdown syntax to produce plain text suitable for non-markdown
 * targets (system clipboard receivers without markdown rendering).
 *
 * The input is treated as Github-flavored markdown. The transformations are
 * intentionally simple line-by-line rewrites; full mdast parsing is overkill
 * for clipboard-quality output.
 */
export function toPlainText(md: string): string {
  let out = md;
  // Fenced code blocks: keep content, drop fences.
  out = out.replace(/^```[^\n]*\n([\s\S]*?)\n```$/gm, "$1");
  // Inline code: drop backticks.
  out = out.replace(/`([^`]+)`/g, "$1");
  // Images: replace with alt text.
  out = out.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // Links: keep text, drop URL.
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Headings: drop leading hashes.
  out = out.replace(/^#{1,6}\s+/gm, "");
  // Blockquotes.
  out = out.replace(/^>\s?/gm, "");
  // Horizontal rules.
  out = out.replace(/^[-*_]{3,}\s*$/gm, "");
  // List bullets.
  out = out.replace(/^(\s*)[-*+]\s+/gm, "$1");
  out = out.replace(/^(\s*)\d+\.\s+/gm, "$1");
  // Bold + italic.
  out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/__([^_]+)__/g, "$1");
  out = out.replace(/\*([^*]+)\*/g, "$1");
  out = out.replace(/_([^_]+)_/g, "$1");
  // Strikethrough.
  out = out.replace(/~~([^~]+)~~/g, "$1");
  return out;
}

/**
 * Convert standard markdown to Slack `mrkdwn` flavor.
 *
 * Slack uses a deliberately small subset:
 *   - `*bold*` (single asterisks)
 *   - `_italic_`
 *   - `~strike~`
 *   - `<url|text>` for links
 *   - no headings (we bolden them)
 *   - bullets via `•`
 *   - fenced + inline code unchanged
 *
 * https://api.slack.com/reference/surfaces/formatting#basic-formatting
 */
export function toSlackMrkdwn(md: string): string {
  let out = md;
  // 1. Convert italics first (single-asterisk and underscore) to a sentinel.
  //    We must do this BEFORE collapsing `**bold**` → `*bold*` because the
  //    output of the bold conversion would otherwise be re-matched as italic.
  //    Slack italics use underscores in the final output. The sentinel uses
  //    SOH (U+0001) bookends around "ITAL" so user text can't collide with it.
  const ITAL = "ITAL";
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, `$1${ITAL}$2${ITAL}`);
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, `$1${ITAL}$2${ITAL}`);
  // 2. Bold → single asterisk.
  out = out.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  out = out.replace(/__([^_]+)__/g, "*$1*");
  // 3. Headings → bold (Slack has no headings).
  out = out.replace(/^#{1,6}\s+(.*)$/gm, "*$1*");
  // 4. Restore italics as underscores.
  const italRe = new RegExp(ITAL, "g");
  out = out.replace(italRe, "_");
  // 5. Strikethrough.
  out = out.replace(/~~([^~]+)~~/g, "~$1~");
  // 6. Links.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");
  // 7. Unordered bullets.
  out = out.replace(/^(\s*)[-+]\s+/gm, "$1•  ");
  // (Asterisk bullets `* item` would collide with bold; handle them after
  // bold is fully converted by re-checking at line start.)
  out = out.replace(/^(\s*)\*\s+/gm, "$1•  ");
  return out;
}

/**
 * Convert markdown source to the requested format and write to the system
 * clipboard. On success shows a sonner toast; on failure surfaces the error
 * (per `error-handling.md` rule).
 */
export async function copyAs(format: ExportFormat, source: string): Promise<void> {
  const payload =
    format === "plain" ? toPlainText(source) : format === "slack" ? toSlackMrkdwn(source) : source;

  try {
    await navigator.clipboard.writeText(payload);
    toast.success(formatLabel(format));
  } catch {
    toast.error("Failed to copy to clipboard");
  }
}

function formatLabel(format: ExportFormat): string {
  switch (format) {
    case "markdown":
      return "Copied as Markdown";
    case "slack":
      return "Copied as Slack mrkdwn";
    case "plain":
      return "Copied as plain text";
  }
}
