export function isLoopbackDevUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    const isLoopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return parsed.protocol === "http:" && isLoopback && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function isAllowedNavigationUrl(rawUrl: string, isPackaged: boolean): boolean {
  if (isPackaged) return rawUrl.startsWith("file://");
  return isLoopbackDevUrl(rawUrl);
}

export function approvedExternalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
