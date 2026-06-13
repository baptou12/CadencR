import path from "node:path";

export function devUserDataPath(appDataPath: string, suffix: string | undefined): string {
  const safeSuffix = suffix ? sanitizeSuffix(suffix) : "";
  const profileName = safeSuffix ? `desktop-dev-${safeSuffix}` : "desktop-dev";
  return path.join(appDataPath, "@cadencr", profileName);
}

function sanitizeSuffix(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
