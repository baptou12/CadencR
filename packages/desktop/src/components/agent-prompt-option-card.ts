/**
 * Shared styling for the option tiles rendered inline in the agent prompt area
 * by the question drawer (`AgentQuestionDrawer`) and the tool-permission prompt
 * (`ToolPermissionPrompt`). Both rendered the same tile by copy-pasting the
 * class strings; this is the single source of truth.
 *
 * The `agent-option-card` marker class is also the CSS hook the Frost theme uses
 * to frost these tiles so they read as crisp glass tappable surfaces instead of
 * the near-invisible `bg-muted/40` default (see `theme-frost.css`).
 */

/** Base shape shared by every tile, regardless of state. */
export const AGENT_OPTION_CARD_BASE =
  "agent-option-card w-full rounded-md border px-3 py-2 text-left transition-colors";

/** Resting (unselected) appearance. */
export const AGENT_OPTION_CARD_RESTING = "border-border bg-muted/40 hover:bg-muted/50";

/** Selected appearance (question drawer single/multi select). */
export const AGENT_OPTION_CARD_SELECTED = "border-primary bg-primary/5 ring-2 ring-primary/30";

/** Keyboard-highlighted appearance (arrow-key navigation flash). */
export const AGENT_OPTION_CARD_HIGHLIGHTED = "ring-2 ring-blue-400 bg-blue-50/10 transition-none";
