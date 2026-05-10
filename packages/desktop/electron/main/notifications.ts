import { Notification, type BrowserWindow } from "electron";

export interface NotifyOptions {
  title: string;
  body: string;
  featureId: number;
  projectId: number;
  routeType: "workflow" | "session";
}

export function notificationPermission(): boolean {
  // `isSupported()` only confirms the OS *can* show notifications; it cannot
  // tell us whether the user has authorized them (macOS exposes no such API).
  // Real authorization failures are surfaced asynchronously via `notification-failed`.
  return Notification.isSupported();
}

export function sendNotification(mainWindow: BrowserWindow, opts: NotifyOptions): void {
  showNotification(mainWindow, opts.title, opts.body, () => {
    safeSend(mainWindow, "notification-clicked", {
      feature_id: opts.featureId,
      project_id: opts.projectId,
      route_type: opts.routeType,
    });
  });
}

export function sendTestNotification(mainWindow: BrowserWindow): void {
  showNotification(
    mainWindow,
    "Cadencr test notification",
    "If you can see this, system notifications are working.",
  );
}

function showNotification(
  mainWindow: BrowserWindow,
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (!Notification.isSupported()) {
    safeSend(mainWindow, "notification-failed", {
      reason: "Notifications are not supported on this system.",
    });
    return;
  }
  const notification = new Notification({ title, body });
  if (onClick) notification.on("click", onClick);
  notification.on("failed", (_event, error) => {
    safeSend(mainWindow, "notification-failed", { reason: error || "Unknown error" });
  });
  notification.show();
}

function safeSend(mainWindow: BrowserWindow, channel: string, payload: unknown): void {
  if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}
