/**
 * Whether a URL is safe to hand to an external browser context. Mirrors the
 * Electron main-process policy (`electron/main/ipc.ts::openExternal`) so the
 * browser-fallback path in `desktop-bridge` can't open anything the desktop
 * shell would reject: `https:` only, no embedded credentials, no loopback. This
 * keeps the same invariant on both code paths instead of trusting raw input to
 * `window.open` in a remote tab.
 */
export function isSafeExternalUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
}
