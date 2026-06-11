import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockWebContents extends EventEmitter {
  id: number;
  session: { webRequest: Record<string, unknown> };
  debugger: {
    isAttached: () => boolean;
    attach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
  };
  loadURL: ReturnType<typeof vi.fn>;
  getURL: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  canGoBack: ReturnType<typeof vi.fn>;
  canGoForward: ReturnType<typeof vi.fn>;
  sendInputEvent: ReturnType<typeof vi.fn>;
  insertText: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  setDevToolsWebContents: ReturnType<typeof vi.fn>;
  openDevTools: ReturnType<typeof vi.fn>;
  closeDevTools: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
}

const webContentsById = new Map<number, MockWebContents>();
let nextWebContentsId = 1;

vi.mock("electron", () => {
  class WebContentsViewMock {
    webContents: MockWebContents;
    setVisible = vi.fn();
    setBounds = vi.fn();

    constructor() {
      const contents = Object.assign(new EventEmitter(), {
        id: nextWebContentsId,
        session: {
          webRequest: {
            onBeforeSendHeaders: vi.fn(),
            onCompleted: vi.fn(),
            onErrorOccurred: vi.fn(),
          },
        },
        debugger: { isAttached: () => false, attach: vi.fn(), sendCommand: vi.fn() },
        loadURL: vi.fn(async (url: string) => {
          contents.getURL.mockReturnValue(url);
        }),
        getURL: vi.fn(() => "about:blank"),
        getTitle: vi.fn(() => ""),
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        sendInputEvent: vi.fn(),
        insertText: vi.fn(),
        close: vi.fn(),
        reload: vi.fn(),
        stop: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setDevToolsWebContents: vi.fn(),
        openDevTools: vi.fn(),
        closeDevTools: vi.fn(),
        executeJavaScript: vi.fn(),
      }) as MockWebContents;
      nextWebContentsId += 1;
      webContentsById.set(contents.id, contents);
      this.webContents = contents;
    }
  }

  return {
    BrowserWindow: class BrowserWindowMock {},
    WebContentsView: WebContentsViewMock,
    session: { fromPartition: vi.fn(() => ({ clearStorageData: vi.fn(), clearCache: vi.fn() })) },
    app: { getPath: vi.fn(() => "/tmp/cadencr-browser-manager-test") },
  };
});

const { BrowserManager } = await import("./browser-manager");

interface MockMainWindow {
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
  };
  webContents: {
    getZoomFactor: () => number;
    isDestroyed: () => boolean;
    send: ReturnType<typeof vi.fn>;
  };
  getBounds: () => Electron.Rectangle;
  getContentBounds: () => Electron.Rectangle;
  isDestroyed: () => boolean;
}

function mainWindow(): MockMainWindow {
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: { getZoomFactor: () => 1, isDestroyed: () => false, send: vi.fn() },
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    isDestroyed: () => false,
  };
}

describe("BrowserManager", () => {
  beforeEach(() => {
    webContentsById.clear();
    nextWebContentsId = 1;
  });

  it("validates mutating automation against the live WebContents URL", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab("http://localhost:5173/signup");
    const contents = [...webContentsById.values()][0];
    contents.getURL.mockReturnValue("https://example.com/phished");

    await expect(manager.click(tab.id, 10, 20)).rejects.toThrow("localhost");
    expect(contents.sendInputEvent).not.toHaveBeenCalled();
  });

  it("allows localhost mutation and forwards input events", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab("http://localhost:5173/signup");
    const contents = [...webContentsById.values()][0];
    contents.getURL.mockReturnValue("http://localhost:5173/signup");

    await manager.click(tab.id, 10, 20);

    expect(contents.sendInputEvent).toHaveBeenCalledWith({
      type: "mouseDown",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    expect(contents.sendInputEvent).toHaveBeenCalledWith({
      type: "mouseUp",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
    });
  });
});
