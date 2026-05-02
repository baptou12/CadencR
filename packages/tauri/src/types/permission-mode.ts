/**
 * Shared permission-mode union. Wire values match the backend's
 * `parse_permission_mode` (packages/service/src/domain/ws_session/handler/mod.rs).
 *
 * Each CLI provider supports a different subset — see `provider-modes.ts` for
 * the per-provider catalog (drives chip rendering & the Shift+Tab cycle) and
 * `provider_supports_mode` on the backend (the validation gate).
 */
export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "plan"
  | "auto"
  | "bypassPermissions"
  | "dontAsk";
