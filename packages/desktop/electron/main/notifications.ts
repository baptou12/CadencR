import { Notification, type BrowserWindow } from "electron";

export interface NotifyOptions {
  title: string;
  body: string;
  featureId: number;
  projectId: number;
  routeType: "workflow" | "session";
}

export function notificationPermission(): boolean {
  return Notification.isSupported();
}

export function sendNotification(mainWindow: BrowserWindow, opts: NotifyOptions): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: opts.title, body: opts.body });
  notification.on("click", () => {
    mainWindow.webContents.send("notification-clicked", {
      feature_id: opts.featureId,
      project_id: opts.projectId,
      route_type: opts.routeType,
    });
  });
  notification.show();
}
