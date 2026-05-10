import { contextBridge, ipcRenderer, webUtils } from "electron";

type RouteType = "workflow" | "session";
type DesktopTheme = "light" | "dark";

interface RuntimeConfig {
  baseUrl: string;
  authToken: string | null;
}

interface NotificationClickPayload {
  feature_id: number;
  project_id: number;
  route_type: RouteType;
}

interface NotifyOptions {
  title: string;
  body: string;
  featureId: number;
  projectId: number;
  routeType: RouteType;
}

interface FileDropItem {
  handle: string;
  name: string;
}

interface FileDropPayload {
  type: "enter" | "leave" | "drop" | "error";
  files: FileDropItem[];
  message?: string;
}

function onIpc<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

function onFileDrop(cb: (payload: FileDropPayload) => void): () => void {
  let dragDepth = 0;
  const onDragOver = (event: DragEvent): void => event.preventDefault();
  const onDragEnter = (event: DragEvent): void => {
    event.preventDefault();
    dragDepth += 1;
    if (dragDepth === 1) cb({ type: "enter", files: [] });
  };
  const onDragLeave = (event: DragEvent): void => {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) cb({ type: "leave", files: [] });
  };
  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    dragDepth = 0;
    const files = Array.from(event.dataTransfer?.files ?? []);
    const paths = files.map((file) => webUtils.getPathForFile(file)).filter(Boolean);
    void ipcRenderer
      .invoke("fs:register-file-paths", paths)
      .then((registered: FileDropItem[]) => {
        cb({ type: "drop", files: registered });
      })
      .catch((error: unknown) => {
        cb({
          type: "error",
          files: [],
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };
  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragenter", onDragEnter);
  document.addEventListener("dragleave", onDragLeave);
  document.addEventListener("drop", onDrop);
  return () => {
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragenter", onDragEnter);
    document.removeEventListener("dragleave", onDragLeave);
    document.removeEventListener("drop", onDrop);
  };
}

contextBridge.exposeInMainWorld("cadencr", {
  isElectron: true,
  runtimeConfig: (): Promise<RuntimeConfig> => ipcRenderer.invoke("runtime-config"),
  readFileBase64: (handle: string): Promise<string> =>
    ipcRenderer.invoke("fs:read-file-base64", handle),
  onFileDrop,
  revealInFinder: (path: string): Promise<void> => ipcRenderer.invoke("shell:reveal", path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:open-external", url),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:pick-directory"),
  notifyPermission: (): Promise<boolean> => ipcRenderer.invoke("notify:permission"),
  notify: (opts: NotifyOptions): Promise<void> => ipcRenderer.invoke("notify:send", opts),
  notifyTest: (): Promise<void> => ipcRenderer.invoke("notify:test"),
  onNotificationClicked: (cb: (payload: NotificationClickPayload) => void): (() => void) =>
    onIpc("notification-clicked", cb),
  onNotificationFailed: (cb: (payload: { reason: string }) => void): (() => void) =>
    onIpc("notification-failed", cb),
  onCloseRequested: (cb: () => void): (() => void) => onIpc("app:close-requested", cb),
  confirmClose: (): Promise<void> => ipcRenderer.invoke("app:confirm-close"),
  requestQuit: (): Promise<void> => ipcRenderer.invoke("app:request-quit"),
  setZoom: (factor: number): Promise<void> => ipcRenderer.invoke("webview:set-zoom", factor),
  currentTheme: (): Promise<DesktopTheme> => ipcRenderer.invoke("theme:current"),
  onThemeChange: (cb: (appearance: DesktopTheme) => void): (() => void) =>
    onIpc("theme:updated", cb),
});
