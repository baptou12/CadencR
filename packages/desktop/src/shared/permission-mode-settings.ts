/**
 * Workspace-setting keys for the per-provider "allow dangerous mode" toggles.
 *
 * Stored as `"true" | "false"` strings via the standard workspace settings
 * API (`useGetWorkspaceSetting`/`useSetWorkspaceSetting`). When the value
 * parses as `"true"`, the corresponding mode (`bypassPermissions` for Claude,
 * `bypassPermissions` for Codex — mapped to `danger-full-access` server-side)
 * becomes part of the Shift+Tab cycle for that provider.
 */
export const CLAUDE_BYPASS_PERMISSIONS_SETTING_KEY = "claude_bypass_permissions_enabled";

export const CODEX_FULL_ACCESS_SETTING_KEY = "codex_full_access_enabled";
