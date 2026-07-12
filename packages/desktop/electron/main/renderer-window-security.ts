import path from "node:path";
import { app, session, shell, type WebContents } from "electron";
import { rendererCsp } from "./csp";
import { approvedExternalUrl, isAllowedNavigationUrl, isLoopbackDevUrl } from "./navigation";
import { packagedRendererDir } from "./sidecar";

export function installCsp(): void {
  const csp = rendererCsp(app.isPackaged);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });
}

export function rendererLoadTarget():
  | { kind: "url"; value: string }
  | { kind: "file"; value: string } {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && rendererUrl) {
    if (!isLoopbackDevUrl(rendererUrl)) {
      throw new Error(`Rejected untrusted ELECTRON_RENDERER_URL: ${rendererUrl}`);
    }
    return { kind: "url", value: rendererUrl };
  }
  const rendererIndex = app.isPackaged
    ? path.join(packagedRendererDir(), "index.html")
    : path.join(__dirname, "../renderer/index.html");
  return { kind: "file", value: rendererIndex };
}

export function secureWebContents(webContents: WebContents): void {
  webContents.setWindowOpenHandler(({ url }) => {
    void openApprovedExternalUrl(url);
    return { action: "deny" };
  });
  webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigationUrl(url, app.isPackaged)) return;
    event.preventDefault();
    void openApprovedExternalUrl(url);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "clipboard-sanitized-write");
  });
}

async function openApprovedExternalUrl(rawUrl: string): Promise<void> {
  const url = approvedExternalUrl(rawUrl);
  if (url) await shell.openExternal(url);
}
