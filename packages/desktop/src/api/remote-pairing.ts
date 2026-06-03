/**
 * Remote-browser pairing bootstrap.
 *
 * The host generates a QR/link of the form
 * `https://<lan-ip>:<port>/?code=<pairing-code>`. When the SPA loads with that
 * `?code=`, we exchange it — over TLS, before React mounts — for a device
 * token, persist it (session-only), and strip the code from the URL so a
 * refresh or a forwarded link can't replay a single-use code. Whether to *stay*
 * signed in is decided on this device after pairing (see the post-pair toast),
 * not encoded in the host's link — so forwarding a link can't silently make the
 * wrong browser persistent.
 *
 * Runs before `preloadRuntimeConfig()` so the token is in place when the API
 * client first reads it. No-op in the desktop shell, and a no-op (beyond URL
 * cleanup) when no code is present — an already-paired device just reuses its
 * stored token.
 */

import { isBrowserRemote, writeDeviceToken } from "@/lib/remote/device-token";

const CODE_PARAM = "code";
/** Legacy host-side trust flag; no longer honored, just stripped from the URL. */
const TRUST_PARAM = "trust";

/** Set when pairing fails so the app can surface a toast once React mounts. */
const PAIRING_ERROR_KEY = "cadencr.remotePairingError";

/** Set after a successful pair so the app can offer "stay signed in" once mounted. */
const JUST_PAIRED_KEY = "cadencr.remoteJustPaired";

interface PairResponseBody {
  device_token: string;
  label: string;
}

function isPairResponseBody(value: unknown): value is PairResponseBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).device_token === "string"
  );
}

export async function ensurePaired(): Promise<void> {
  if (!isBrowserRemote()) return;
  const params = new URLSearchParams(location.search);
  const code = params.get(CODE_PARAM);
  if (!code) return;

  try {
    const resp = await fetch(`${location.origin}/api/remote/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!resp.ok) {
      throw new Error(
        resp.status === 400
          ? "This pairing link has expired. Generate a fresh one on the host."
          : `Pairing failed (HTTP ${resp.status}).`,
      );
    }
    const body: unknown = await resp.json();
    if (!isPairResponseBody(body)) {
      throw new Error("The pairing response was malformed.");
    }
    // Session-only by default. The "stay signed in" opt-in happens on this
    // device after mount; only flag that offer if storage actually works.
    if (writeDeviceToken(body.device_token, false)) {
      flagJustPaired();
    } else {
      stashPairingError(
        "Paired, but this browser blocks storage — you'll need to re-pair after a reload.",
      );
    }
  } catch (err) {
    // Pre-React: stash the message so the app can toast it after mount. We
    // still let the app load (an unauthenticated state the UI surfaces) rather
    // than blocking on a stale or bad code.
    stashPairingError(err instanceof Error ? err.message : "Pairing failed.");
  } finally {
    stripPairingParams(params);
  }
}

/** Pop the one-shot pairing error (consumed once by the app after mount). */
export function takePairingError(): string | null {
  return takeFlag(PAIRING_ERROR_KEY);
}

/**
 * Pop the one-shot "just paired" flag. True once, immediately after a fresh
 * pair, so the app can offer to keep this device signed in.
 */
export function takeJustPaired(): boolean {
  return takeFlag(JUST_PAIRED_KEY) === "1";
}

function takeFlag(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    if (value) sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

function flagJustPaired(): void {
  try {
    sessionStorage.setItem(JUST_PAIRED_KEY, "1");
  } catch {
    // Offering the persistence opt-in is best-effort; nothing to surface.
  }
}

function stashPairingError(message: string): void {
  try {
    sessionStorage.setItem(PAIRING_ERROR_KEY, message);
  } catch {
    // Storage unavailable; the console error below is the only signal left.
  }
  console.error("[remote-pairing]", message);
}

function stripPairingParams(params: URLSearchParams): void {
  params.delete(CODE_PARAM);
  params.delete(TRUST_PARAM);
  const query = params.toString();
  history.replaceState(null, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
}
