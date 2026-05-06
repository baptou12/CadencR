/**
 * Pure heuristic that decides whether the streamed PTY buffer ends with a
 * prompt the user needs to answer. Kept side-effect-free so the dialog's
 * "show passphrase input" decision is a deterministic function of the
 * buffer string, easy to test, easy to reason about.
 *
 * The function returns the **byte offset where the prompt starts** (so the
 * dialog can store "I already answered this prompt" by remembering the
 * offset), or `null` when the tail isn't a prompt. Storing offsets lets
 * the dialog distinguish "same prompt still showing" from "agent is
 * asking us a *new* question further down the buffer".
 */

/**
 * Discriminator for the kind of input we're going to show. `password`
 * masks input; `confirm` shows it as plain text (so the user can see
 * "yes" vs "no" before submitting). Returned alongside the offset so
 * the dialog picks the right input element without re-running regexes.
 */
export type SshPromptKind = "password" | "confirm";

export interface DetectedSshPrompt {
  /** Byte offset of the *first* character of the matched prompt line. */
  offset: number;
  kind: SshPromptKind;
  /** Verbatim prompt text — surfaced in the dialog as the input's label. */
  text: string;
}

// One regex per prompt family. Anchored to a line start (`(^|[\r\n])`)
// because PTY output uses both `\r\n` (after `ONLCR` post-processing) and
// bare `\r` (some tools, notably anything that draws an in-place progress
// bar, write a leading `\r` before the next line of text — without a
// `\n` between them). Also tolerate any non-newline character class in
// the body: `[^\r\n]` instead of `[^\n]` — otherwise a stray `\r` mid-
// prompt (also common on PTYs) would let `[^\n]*` swallow past the real
// line boundary and break the match.
//
// We want to pick up the *last* prompt printed, and since these all end
// in `:` or `?` followed by EOF (ssh writes the prompt and waits without
// a trailing newline), every pattern ends with `\s*$`.
const PROMPT_PATTERNS: { re: RegExp; kind: SshPromptKind }[] = [
  // OpenSSH passphrase prompts. Format: `Enter passphrase for key '<path>':`
  { re: /(^|[\r\n])(Enter passphrase for [^\r\n]*:)\s*$/, kind: "password" },
  // OpenSSH password-auth prompt for a remote user.
  // Format: `<user>@<host>'s password:`
  { re: /(^|[\r\n])([^\r\n]+'s password:)\s*$/, kind: "password" },
  // Generic "password:" line — HTTPS git credential helper, sudo wraps,
  // etc. Kept last so the more-specific matches above win when multiple
  // could apply.
  { re: /(^|[\r\n])(password:)\s*$/i, kind: "password" },
  // First-time host-key prompt. ssh appends a literal `(yes/no/[fingerprint])?`
  // (or older `(yes/no)?`) and waits for a line of input.
  {
    re: /(^|[\r\n])([^\r\n]*Are you sure you want to continue connecting[^\r\n]*\?)\s*$/,
    kind: "confirm",
  },
  // HTTPS credential-helper username prompt — comes before the password
  // line. Render as plain text input.
  { re: /(^|[\r\n])(Username for [^\r\n]+:)\s*$/, kind: "confirm" },
];

/**
 * Inspect `buffer` and return prompt metadata if its tail looks like a
 * prompt. We only care about the *last* line — ssh prints the prompt and
 * then reads from the tty, so the prompt is always the final non-empty
 * line of the buffer at the moment we need to decide.
 */
export function detectSshPrompt(buffer: string): DetectedSshPrompt | null {
  if (!buffer) return null;
  // Strip trailing whitespace so a single `\n` after the prompt (some
  // terminals echo one) doesn't break the anchor.
  const trimmed = buffer.replace(/\s+$/u, "");
  if (!trimmed) return null;
  for (const { re, kind } of PROMPT_PATTERNS) {
    const match = re.exec(trimmed);
    if (!match) continue;
    // `match.index` is the position of the leading `(^|\n)`; the prompt
    // itself starts at the next character when we matched a `\n`, or at
    // `match.index` when the buffer starts with the prompt.
    const lead = match[1] ?? "";
    const text = match[2] ?? "";
    const offset = match.index + lead.length;
    return { offset, kind, text };
  }
  return null;
}
