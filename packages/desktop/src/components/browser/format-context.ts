import type { BrowserElementContext } from "@/lib/desktop-bridge";

/** One pending annotation: a user comment anchored to a picked DOM element. */
export interface BrowserComment {
  id: string;
  context: BrowserElementContext;
  text: string;
  /** Whether to attach the captured region screenshot when sending. */
  includeScreenshot: boolean;
}

export function isSecureUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/** A short human label for a picked element (tag#id.class), for the comment chip. */
export function describeElement(context: BrowserElementContext): string {
  const { tagName, id, className } = context.element;
  const idPart = id ? `#${id}` : "";
  const classPart =
    typeof className === "string" && className.trim()
      ? `.${className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  return `${tagName.toLowerCase()}${idPart}${classPart}`;
}

// The DOM anchor details the agent needs to relocate the node, as a markdown
// bullet list so each fact reads on its own line instead of one dense run.
function elementDetails(context: BrowserElementContext): string {
  const el = context.element;
  const lines = [`- **Tag:** \`<${el.tagName.toLowerCase()}>\``];
  if (el.selectorCandidates.length > 0) {
    lines.push(`- **Selectors:** ${el.selectorCandidates.map((s) => `\`${s}\``).join(", ")}`);
  }
  if (el.accessibility?.role || el.accessibility?.name) {
    const a11y = [el.accessibility.role, el.accessibility.name].filter(Boolean).join(" — ");
    lines.push(`- **Accessibility:** ${a11y}`);
  }
  if (el.textPreview) lines.push(`- **Text:** "${el.textPreview}"`);
  return lines.join("\n");
}

/**
 * Compose one user message from a batch of comments so the agent receives a
 * single coherent request. Rendered as markdown — a heading per comment with
 * the user's note up top and the DOM anchor as a bullet list — so it reads
 * clearly both in the conversation and to the agent instead of a wall of text.
 */
export function formatComments(comments: BrowserComment[]): string {
  if (comments.length === 0) return "";
  const pageUrl = comments[0].context.url;
  const header =
    comments.length === 1
      ? `**Browser comment** from \`${pageUrl}\``
      : `**${comments.length} browser comments** from \`${pageUrl}\``;
  const blocks = comments.map((comment, index) => {
    const note = comment.text.trim() || "_(no comment)_";
    const heading =
      comments.length === 1
        ? `### \`${describeElement(comment.context)}\``
        : `### Comment ${index + 1} · \`${describeElement(comment.context)}\``;
    return `${heading}\n\n${note}\n\n${elementDetails(comment.context)}`;
  });
  return `${header}\n\n${blocks.join("\n\n---\n\n")}`;
}
