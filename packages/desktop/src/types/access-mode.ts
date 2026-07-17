export const ACCESS_MODES = ["default", "fullAccess", "autoReview"] as const;

export type AccessMode = (typeof ACCESS_MODES)[number];

export function parseAccessMode(value: unknown): AccessMode {
  if (typeof value !== "string") return "default";
  return (ACCESS_MODES as readonly string[]).includes(value) ? (value as AccessMode) : "default";
}
