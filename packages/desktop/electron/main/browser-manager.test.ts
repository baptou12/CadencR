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
const createdViews: Array<{
  setVisible: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
}> = [];
let nextWebContentsId = 1;

vi.mock("electron", () => {
  class WebContentsViewMock {
    webContents: MockWebContents;
    setVisible = vi.fn();
    setBounds = vi.fn();

    constructor() {
      createdViews.push(this);
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
    createdViews.length = 0;
    nextWebContentsId = 1;
  });

  it("scales native bounds by the renderer-supplied zoom factor, not the main window's", () => {
    // The main window reports zoom 1, but the renderer measured its bounds at
    // zoom 2. Trusting the renderer's factor keeps the native view aligned with
    // the placeholder even while a zoom change is still propagating to main.
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const view = createdViews[0];
    view.setBounds.mockClear();

    manager.setBounds({ x: 100, y: 50, width: 300, height: 200 }, 1, 2);

    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 200, y: 100, width: 600, height: 400 });
  });

  it("falls back to the main window zoom factor when the renderer omits one", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const view = createdViews[0];
    view.setBounds.mockClear();

    manager.setBounds({ x: 100, y: 50, width: 300, height: 200 }, 1);

    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 100, y: 50, width: 300, height: 200 });
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

  it("isolates tabs per feature scope", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const a = manager.createTab(undefined, "fresh", 1);
    const b = manager.createTab(undefined, "fresh", 2);

    // Each feature only sees — and treats as active — its own tab.
    expect(manager.state(1).tabs.map((t) => t.id)).toEqual([a.id]);
    expect(manager.state(2).tabs.map((t) => t.id)).toEqual([b.id]);
    expect(manager.state(1).activeTabId).toBe(a.id);
    expect(manager.state(2).activeTabId).toBe(b.id);
    // The unscoped (agent/MCP) view still sees every tab.
    expect(
      manager
        .state()
        .tabs.map((t) => t.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it("counts open tabs by feature scope", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 2);
    manager.createTab(undefined, "fresh", null);

    expect(manager.tabCountsByScope()).toEqual({ 1: 2, 2: 1 });
  });

  it("emits tab counts only when tab membership changes", () => {
    const win = mainWindow();
    const manager = new BrowserManager(() => win as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);

    expect(win.webContents.send).toHaveBeenCalledWith("browser:tab-counts", { 1: 1 });
    win.webContents.send.mockClear();

    manager.navigate(tab.id, "http://localhost:1420");
    expect(win.webContents.send).not.toHaveBeenCalledWith("browser:tab-counts", expect.anything());

    manager.closeTab(tab.id);
    expect(win.webContents.send).toHaveBeenCalledWith("browser:tab-counts", {});
  });

  it("promotes the next tab in the same scope when a feature's active tab closes", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const a1 = manager.createTab(undefined, "fresh", 1);
    const a2 = manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 2);

    manager.closeTab(a2.id);

    // Closing feature 1's active tab falls back to feature 1's other tab, never
    // to feature 2's.
    expect(manager.state(1).tabs.map((t) => t.id)).toEqual([a1.id]);
    expect(manager.state(1).activeTabId).toBe(a1.id);
  });

  it("keeps the unscoped (agent/MCP) view active after a scope's last tab closes", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const a = manager.createTab(undefined, "fresh", 1);
    const b = manager.createTab(undefined, "fresh", 2);

    // Closing feature 2's only tab (the most-recently active) must not strand
    // the unscoped view at null — it falls back to the surviving tab.
    expect(manager.state().activeTabId).toBe(b.id);
    manager.closeTab(b.id);
    expect(manager.state().activeTabId).toBe(a.id);
  });
});
