import {
  isPermissionGranted,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let permissionCache: boolean | null = null;

// Track window focus via DOM events instead of async IPC
let windowFocused = false;
let initialized = false;

/**
 * Initialize notification permission check and window focus tracking.
 * Must be called once at app startup before any notifications are sent.
 */
export async function initNotificationPermission(): Promise<void> {
  if (!initialized) {
    initialized = true;
    windowFocused = document.hasFocus();
    window.addEventListener("focus", () => { windowFocused = true; });
    window.addEventListener("blur", () => { windowFocused = false; });
  }
  permissionCache = await isPermissionGranted();
}

interface NotifyOptions {
  status: "completed" | "error";
  featureTitle: string;
}

/**
 * Send a native desktop notification when an agent finishes, but only if the
 * app window is not currently focused. Clicking the notification focuses the
 * app window (macOS default behavior).
 *
 * Note: navigation on click is not supported on macOS — onAction is mobile-only.
 * See: https://github.com/tauri-apps/plugins-workspace/issues/2150
 */
export function notifyAgentDone(opts: NotifyOptions): void {
  if (windowFocused) return;
  if (!permissionCache) return;

  sendNotification({
    title: opts.status === "completed" ? "Agent finished" : "Agent error",
    body: opts.featureTitle,
  });
}
