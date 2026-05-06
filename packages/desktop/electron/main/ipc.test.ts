import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

const electronState = vi.hoisted(() => ({
  isPackaged: false,
  openExternal: vi.fn<(_url: string) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
  },
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
  shell: { openExternal: electronState.openExternal, showItemInFolder: vi.fn() },
}));

import {
  assertTrustedSender,
  canonicalFilePath,
  clearRegisteredFilePaths,
  openExternal,
  parseNotifyOptions,
  parseZoomFactor,
  readFileBase64,
  registerFilePaths,
} from "./ipc";

function trustedEvent(
  senderFrameUrl: string | null = "http://127.0.0.1:1420/",
): IpcMainInvokeEvent {
  return {
    sender: { id: 7 },
    senderFrame: senderFrameUrl === null ? null : { url: senderFrameUrl },
  } as unknown as IpcMainInvokeEvent;
}

function ipcEvent(senderId: number, senderFrameUrl: string | null): IpcMainInvokeEvent {
  return {
    sender: { id: senderId },
    senderFrame: senderFrameUrl === null ? null : { url: senderFrameUrl },
  } as unknown as IpcMainInvokeEvent;
}

function mainWindow(): BrowserWindow {
  return { webContents: { id: 7 } } as unknown as BrowserWindow;
}

describe("ipc validators", () => {
  beforeEach(() => {
    electronState.isPackaged = false;
    electronState.openExternal.mockClear();
    clearRegisteredFilePaths();
  });

  it("bounds zoom factors", () => {
    expect(parseZoomFactor(1.25)).toBe(1.25);
    expect(() => parseZoomFactor(0.49)).toThrow(/between 0.5 and 2/);
    expect(() => parseZoomFactor(Number.NaN)).toThrow(/numeric/);
  });

  it("validates notification options", () => {
    expect(
      parseNotifyOptions({
        title: "Done",
        body: "Agent complete",
        featureId: 1,
        projectId: 2,
        routeType: "workflow",
      }),
    ).toEqual({
      title: "Done",
      body: "Agent complete",
      featureId: 1,
      projectId: 2,
      routeType: "workflow",
    });
    expect(() => parseNotifyOptions({ routeType: "bad" })).toThrow(/route type/);
  });

  it("canonicalizes files and rejects traversal and directories", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cadencr-ipc-"));
    const file = path.join(dir, "image.png");
    await fs.writeFile(file, "hello", "utf8");

    await expect(canonicalFilePath(file)).resolves.toBe(await fs.realpath(file));
    await expect(canonicalFilePath(`${dir}/../${path.basename(dir)}/image.png`)).rejects.toThrow(
      /contains `\.\.`/,
    );
    await expect(canonicalFilePath(dir)).rejects.toThrow(/not a file/);
  });

  it("uses dropped-file handles once", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cadencr-handle-"));
    const file = path.join(dir, "image.png");
    await fs.writeFile(file, "hello", "utf8");

    const [registered] = await registerFilePaths([file]);

    await expect(readFileBase64(registered.handle)).resolves.toBe(
      Buffer.from("hello").toString("base64"),
    );
    await expect(readFileBase64(registered.handle)).rejects.toThrow(/expired/);
  });

  it("opens only approved external urls", async () => {
    await openExternal("https://example.com/path");
    await expect(openExternal("http://example.com")).rejects.toThrow(/https/);
    await expect(openExternal("https://user@example.com")).rejects.toThrow(/credentials/);
    await expect(openExternal("https://127.0.0.1:5004")).rejects.toThrow(/Loopback/);
    expect(electronState.openExternal).toHaveBeenCalledTimes(1);
  });

  it("accepts null senderFrame only after the sender webContents matched", () => {
    expect(() => assertTrustedSender(trustedEvent(null), () => mainWindow())).not.toThrow();
    expect(() => assertTrustedSender(ipcEvent(8, null), () => mainWindow())).toThrow(
      /untrusted window/,
    );
    expect(() =>
      assertTrustedSender(trustedEvent("https://evil.example"), () => mainWindow()),
    ).toThrow(/untrusted renderer/);
  });
});
