export const CODEX_PERMISSION_MODES = ["default", "fullAccess", "autoReview"] as const;

export type CodexPermissionMode = (typeof CODEX_PERMISSION_MODES)[number];

export function parseCodexPermissionMode(value: unknown): CodexPermissionMode {
  if (typeof value !== "string") return "default";
  return (CODEX_PERMISSION_MODES as readonly string[]).includes(value)
    ? (value as CodexPermissionMode)
    : "default";
}
