export const PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "bypassPermissions",
  "dontAsk",
] as const;

/**
 * Shared permission-mode union. Wire values match the backend's
 * `parse_permission_mode` (packages/service/src/domain/ws_session/handler/mod.rs).
 *
 * Each CLI provider supports a different subset — see `provider-modes.ts` for
 * the per-provider catalog (drives chip rendering & the Shift+Tab cycle) and
 * `provider_supports_mode` on the backend (the validation gate).
 */
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export function parsePermissionMode(value: unknown): PermissionMode | null {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value)
    ? (value as PermissionMode)
    : null;
}
