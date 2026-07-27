/**
 * Claude Code profile naming. Lives in `lib/` rather than `api/agentRuntime`
 * because it is pure display logic with no transport concern — and because
 * agent tests routinely `vi.mock` that API module, which would stub the label
 * helper out from under any component that renders a profile name.
 */

export const DEFAULT_CLAUDE_PROFILE_NAME = "default";

/** The backend spells the default profile more than one way. */
const DEFAULT_PROFILE_ALIASES = new Set([DEFAULT_CLAUDE_PROFILE_NAME, "default (recommended)"]);

/**
 * Display name for a profile. Every surface that shows one must agree on a
 * single label, or the picker and the settings page disagree about which
 * profile is selected.
 */
export function formatClaudeProfileLabel(profile: string): string {
  return DEFAULT_PROFILE_ALIASES.has(profile.trim().toLowerCase()) ? "Default" : profile;
}
