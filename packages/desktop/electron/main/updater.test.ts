import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

const electronState = vi.hoisted(() => ({
  isPackaged: true,
  handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
}));

const imageState = vi.hoisted(() => ({ fetchChangelogImage: vi.fn() }));

vi.mock("./changelog-images", () => ({ fetchChangelogImage: imageState.fetchChangelogImage }));

const updaterState = vi.hoisted(() => ({
  quitAndInstall: vi.fn(),
  checkForUpdates: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
}));

vi.mock("./linux-install-type", () => ({
  detectLinuxInstallType: vi.fn(() => "deb"),
}));

vi.mock("./renderer-window-security", () => ({
  rendererLoadTarget: () => ({ kind: "file", value: "/app/index.html" }),
}));

vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return electronState.isPackaged;
    },
    getVersion: () => "0.1.0",
  },
  ipcMain: {
    handle: vi.fn(
      (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
        electronState.handlers.set(channel, handler);
      },
    ),
  },
}));

vi.mock("electron-updater", () => ({
  default: {
    autoUpdater: {
      get autoDownload() {
        return true;
      },
      set autoDownload(_value: boolean) {},
      get autoInstallOnAppQuit() {
        return true;
      },
      set autoInstallOnAppQuit(_value: boolean) {},
      get logger() {
        return console;
      },
      set logger(_value: Console) {},
      checkForUpdates: updaterState.checkForUpdates,
      quitAndInstall: updaterState.quitAndInstall,
      on: updaterState.on,
    },
  },
}));

function trustedEvent(): IpcMainInvokeEvent {
  return {
    sender: { id: 7 },
    senderFrame: { url: "file:///app/index.html", processId: 1, routingId: 2 },
  } as unknown as IpcMainInvokeEvent;
}

function mainWindow(): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      id: 7,
      mainFrame: { url: "file:///app/index.html", processId: 1, routingId: 2 },
      isDestroyed: () => false,
      send: vi.fn(),
    },
  } as unknown as BrowserWindow;
}

describe("auto-updater IPC", () => {
  beforeEach(() => {
    vi.resetModules();
    electronState.isPackaged = true;
    electronState.handlers.clear();
    updaterState.quitAndInstall.mockClear();
    updaterState.checkForUpdates.mockClear();
    updaterState.on.mockClear();
    imageState.fetchChangelogImage.mockReset();
  });

  it("runs install preparation before quitAndInstall for a Linux deb package", async () => {
    const { registerAutoUpdaterIpc } = await import("./updater");
    const calls: string[] = [];

    registerAutoUpdaterIpc({
      getMainWindow: () => mainWindow(),
      prepareInstallUpdate: async () => {
        calls.push("prepare");
      },
    });

    updaterState.quitAndInstall.mockImplementation(() => calls.push("quitAndInstall"));

    const handler = electronState.handlers.get("app:install-update");
    expect(handler).toBeDefined();
    await handler?.(trustedEvent());

    const checkHandler = electronState.handlers.get("app:check-for-updates");
    expect(checkHandler).toBeDefined();
    await checkHandler?.(trustedEvent());

    expect(calls).toEqual(["prepare", "quitAndInstall"]);
    expect(updaterState.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(updaterState.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("rejects malformed image arguments before fetching", async () => {
    const { registerAutoUpdaterIpc } = await import("./updater");
    registerAutoUpdaterIpc({ getMainWindow: mainWindow });
    const handler = electronState.handlers.get("app:fetch-changelog-image");
    expect(handler).toBeDefined();

    for (const source of [undefined, null, 42, {}, []]) {
      await expect(handler?.(trustedEvent(), source)).rejects.toThrow(
        "Image source must be a string.",
      );
    }
    expect(imageState.fetchChangelogImage).not.toHaveBeenCalled();
  });

  it("fetches a validated image source from a trusted sender", async () => {
    const { registerAutoUpdaterIpc } = await import("./updater");
    registerAutoUpdaterIpc({ getMainWindow: mainWindow });
    const source = "https://raw.githubusercontent.com/merkr-software/cadencr/v0.13.1/docs/shot.png";
    const response = { data: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" };
    imageState.fetchChangelogImage.mockResolvedValue(response);
    const handler = electronState.handlers.get("app:fetch-changelog-image");
    expect(handler).toBeDefined();

    await expect(handler?.(trustedEvent(), source)).resolves.toEqual(response);
    expect(imageState.fetchChangelogImage).toHaveBeenCalledWith(source);
  });

  describe("a latest release without latest-linux.yml", () => {
    const realPlatform = process.platform;
    const missingFeed = Object.assign(new Error("Cannot find latest-linux.yml"), {
      code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: realPlatform });
    });

    async function checkWith(platform: NodeJS.Platform, error: Error) {
      Object.defineProperty(process, "platform", { value: platform });
      updaterState.checkForUpdates.mockImplementationOnce(() => Promise.reject(error));
      const { registerAutoUpdaterIpc } = await import("./updater");
      const window = mainWindow();
      registerAutoUpdaterIpc({ getMainWindow: () => window });
      await electronState.handlers.get("app:check-for-updates")?.(trustedEvent());
      await vi.waitFor(() => expect(window.webContents.send).toHaveBeenCalledOnce());
      return vi.mocked(window.webContents.send).mock.calls[0];
    }

    it("means no update yet on Linux, where the alpha packages are attached by hand", async () => {
      expect(await checkWith("linux", missingFeed)).toEqual([
        "update:not-available",
        { version: "0.1.0" },
      ]);
    });

    it("stays an error on macOS, whose feed every release carries", async () => {
      expect(await checkWith("darwin", missingFeed)).toEqual([
        "update:error",
        { message: "Cannot find latest-linux.yml" },
      ]);
    });

    it("leaves other Linux update failures as errors", async () => {
      expect(await checkWith("linux", new Error("network down"))).toEqual([
        "update:error",
        { message: "network down" },
      ]);
    });
  });
});
