import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockWebContents extends EventEmitter {
  id: number;
  session: {
    webRequest: Record<string, unknown>;
    fetch: ReturnType<typeof vi.fn>;
    setPermissionRequestHandler: ReturnType<typeof vi.fn>;
    setPermissionCheckHandler: ReturnType<typeof vi.fn>;
  };
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
  goBack: ReturnType<typeof vi.fn>;
  goForward: ReturnType<typeof vi.fn>;
  getZoomFactor: ReturnType<typeof vi.fn<() => number>>;
  setZoomFactor: ReturnType<typeof vi.fn>;
  findInPage: ReturnType<typeof vi.fn>;
  stopFindInPage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  sendInputEvent: ReturnType<typeof vi.fn>;
  insertText: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn<() => boolean>>;
  reload: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  setDevToolsWebContents: ReturnType<typeof vi.fn>;
  openDevTools: ReturnType<typeof vi.fn>;
  closeDevTools: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  isLoading: ReturnType<typeof vi.fn>;
}

const webContentsById = new Map<number, MockWebContents>();
const createdViews: Array<{
  setVisible: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
  partition?: string;
}> = [];
const sessionsByPartition = new Map<
  string,
  {
    closeAllConnections: ReturnType<typeof vi.fn>;
    clearData: ReturnType<typeof vi.fn>;
    clearAuthCache: ReturnType<typeof vi.fn>;
  }
>();
let nextWebContentsId = 1;
let failNetworkRegistration = false;

vi.mock("electron", () => {
  class WebContentsViewMock {
    private readonly contents: MockWebContents;
    setVisible = vi.fn();
    setBounds = vi.fn();
    partition?: string;

    get webContents(): MockWebContents {
      if (this.contents.isDestroyed()) {
        throw new Error("Electron released WebContentsView.webContents");
      }
      return this.contents;
    }

    constructor(options?: { webPreferences?: { partition?: string } }) {
      this.partition = options?.webPreferences?.partition;
      createdViews.push(this);
      let destroyed = false;
      let zoomFactor = 1;
      let findRequestId = 0;
      const contents = Object.assign(new EventEmitter(), {
        id: nextWebContentsId,
        session: {
          webRequest: {
            onBeforeSendHeaders: vi.fn(() => {
              if (failNetworkRegistration) throw new Error("network registration failed");
            }),
            onCompleted: vi.fn(),
            onErrorOccurred: vi.fn(),
          },
          fetch: vi.fn(
            async () =>
              new Response(new Uint8Array([137, 80, 78, 71]), {
                headers: { "content-type": "image/png" },
              }),
          ),
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
        },
        debugger: { isAttached: () => false, attach: vi.fn(), sendCommand: vi.fn() },
        loadURL: vi.fn(async (url: string) => {
          contents.getURL.mockReturnValue(url);
        }),
        getURL: vi.fn(() => "about:blank"),
        getTitle: vi.fn(() => ""),
        canGoBack: vi.fn(() => false),
        canGoForward: vi.fn(() => false),
        goBack: vi.fn(),
        goForward: vi.fn(),
        getZoomFactor: vi.fn(() => zoomFactor),
        setZoomFactor: vi.fn((factor: number) => {
          zoomFactor = factor;
        }),
        findInPage: vi.fn(() => ++findRequestId),
        stopFindInPage: vi.fn(),
        focus: vi.fn(),
        sendInputEvent: vi.fn(),
        insertText: vi.fn(),
        close: vi.fn(() => {
          if (destroyed) return;
          destroyed = true;
          contents.emit("destroyed");
        }),
        isDestroyed: vi.fn(() => destroyed),
        reload: vi.fn(),
        stop: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setDevToolsWebContents: vi.fn(),
        openDevTools: vi.fn(),
        closeDevTools: vi.fn(),
        executeJavaScript: vi.fn(),
        isLoading: vi.fn(() => false),
      }) as MockWebContents;
      nextWebContentsId += 1;
      webContentsById.set(contents.id, contents);
      this.contents = contents;
    }
  }

  return {
    BrowserWindow: class BrowserWindowMock {},
    WebContentsView: WebContentsViewMock,
    session: {
      fromPartition: vi.fn((partition: string) => {
        let target = sessionsByPartition.get(partition);
        if (!target) {
          target = {
            closeAllConnections: vi.fn(async () => undefined),
            clearData: vi.fn(async () => undefined),
            clearAuthCache: vi.fn(async () => undefined),
          };
          sessionsByPartition.set(partition, target);
        }
        return target;
      }),
    },
    app: { getPath: vi.fn(() => "/tmp/cadencr-browser-manager-test") },
  };
});

const { BrowserManager } = await import("./browser-manager");
const { BrowserOriginStore } = await import("./browser-origin-store");
type BrowserTabSessionStore = import("./browser-tab-session-store").BrowserTabSessionStore;
type RestorableBrowserScope = import("./browser-tab-session-store").RestorableBrowserScope;

interface MockMainWindow {
  contentView: {
    addChildView: ReturnType<typeof vi.fn>;
    removeChildView: ReturnType<typeof vi.fn>;
  };
  webContents: {
    getZoomFactor: () => number;
    isDestroyed: () => boolean;
    send: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
  };
  getBounds: () => Electron.Rectangle;
  getContentBounds: () => Electron.Rectangle;
  isDestroyed: () => boolean;
}

function mainWindow(): MockMainWindow {
  return {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    webContents: {
      getZoomFactor: () => 1,
      isDestroyed: () => false,
      send: vi.fn(),
      focus: vi.fn(),
    },
    getBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    getContentBounds: () => ({ x: 0, y: 0, width: 1000, height: 800 }),
    isDestroyed: () => false,
  };
}

function tabSessionStore(saved: RestorableBrowserScope | null = null): {
  store: BrowserTabSessionStore;
  loadScope: ReturnType<typeof vi.fn>;
  replaceScope: ReturnType<typeof vi.fn>;
} {
  const loadScope = vi.fn(async () => saved);
  const replaceScope = vi.fn(async () => undefined);
  return {
    store: {
      loadScope,
      replaceScope,
      flush: vi.fn(async () => undefined),
    } as unknown as BrowserTabSessionStore,
    loadScope,
    replaceScope,
  };
}

describe("BrowserManager", () => {
  beforeEach(() => {
    webContentsById.clear();
    createdViews.length = 0;
    sessionsByPartition.clear();
    nextWebContentsId = 1;
    failNetworkRegistration = false;
    vi.restoreAllMocks();
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

  it("synchronizes main-frame SPA navigation without a title event and ignores subframes", () => {
    const win = mainWindow();
    const manager = new BrowserManager(() => win as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    contents.getURL.mockReturnValue("https://example.com/iframe-route");
    contents.canGoBack.mockReturnValue(true);

    contents.emit("did-navigate-in-page", {}, "https://example.com/iframe-route", false, 2, 3);
    expect(manager.state(1).tabs[0]?.url).toBe("about:blank");

    contents.getURL.mockReturnValue("https://example.com/spa-replaced?test=lot2a");
    contents.emit(
      "did-navigate-in-page",
      {},
      "https://example.com/spa-replaced?test=lot2a",
      true,
      2,
      1,
    );

    expect(manager.state(1).tabs[0]).toMatchObject({
      id: tab.id,
      url: "https://example.com/spa-replaced?test=lot2a",
      canGoBack: true,
    });
  });

  it("correlates find results and drops stale results after navigation", () => {
    const win = mainWindow();
    const manager = new BrowserManager(() => win as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    manager.page.find(tab.id, {
      requestToken: "renderer-request-1",
      query: "cadencrneedle",
      forward: true,
      findNext: true,
    });
    expect(contents.findInPage).toHaveBeenCalledWith("cadencrneedle", {
      forward: true,
      findNext: true,
    });

    contents.emit(
      "found-in-page",
      {},
      {
        requestId: 1,
        activeMatchOrdinal: 1,
        matches: 3,
        selectionArea: { x: 0, y: 0, width: 10, height: 10 },
        finalUpdate: true,
      },
    );
    expect(win.webContents.send).toHaveBeenCalledWith("browser:find-result", {
      tabId: tab.id,
      requestToken: "renderer-request-1",
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: true,
    });

    win.webContents.send.mockClear();
    manager.navigate(tab.id, "https://example.com/next");
    expect(contents.stopFindInPage).toHaveBeenCalledWith("clearSelection");
    contents.emit(
      "found-in-page",
      {},
      {
        requestId: 1,
        activeMatchOrdinal: 2,
        matches: 3,
        selectionArea: { x: 0, y: 0, width: 10, height: 10 },
        finalUpdate: true,
      },
    );
    expect(win.webContents.send).not.toHaveBeenCalledWith("browser:find-result", expect.anything());
  });

  it("reads actual zoom factors for the changed tab and same-origin siblings", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const first = manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 1);
    const [firstContents, siblingContents] = [...webContentsById.values()];
    siblingContents.getZoomFactor.mockReturnValue(1.2);

    manager.page.zoom(first.id, "in");

    expect(firstContents.setZoomFactor).toHaveBeenCalledWith(1.2);
    expect(manager.state(1).tabs.map((tab) => tab.zoomPercent)).toEqual([120, 120]);

    siblingContents.getZoomFactor.mockReturnValue(1);
    manager.page.zoom(first.id, "reset");
    expect(firstContents.setZoomFactor).toHaveBeenLastCalledWith(1);
    expect(manager.state(1).tabs.map((tab) => tab.zoomPercent)).toEqual([100, 100]);
  });

  it("relays configured find and zoom-reset shortcuts from a focused guest", () => {
    const win = mainWindow();
    const manager = new BrowserManager(() => win as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    const primaryModifier = process.platform === "darwin" ? { meta: true } : { control: true };
    manager.page.setGuestShortcutBindings({
      find: { keys: ["mod", "k"] },
      zoomReset: { keys: ["mod", "9"] },
    });

    for (const [key, shortcut] of [
      ["k", "find"],
      ["9", "zoom-reset"],
    ] as const) {
      const event = { preventDefault: vi.fn() };
      contents.emit("before-input-event", event, {
        type: "keyDown",
        key,
        code: key === "k" ? "KeyK" : "Digit9",
        meta: false,
        control: false,
        shift: false,
        alt: false,
        ...primaryModifier,
      });
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(win.webContents.send).toHaveBeenCalledWith("browser:shortcut", shortcut);
    }
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

  it("emits tab counts only when tab membership changes", async () => {
    const win = mainWindow();
    const manager = new BrowserManager(() => win as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);

    expect(win.webContents.send).toHaveBeenCalledWith("browser:tab-counts", { 1: 1 });
    win.webContents.send.mockClear();

    manager.navigate(tab.id, "http://localhost:1420");
    expect(win.webContents.send).not.toHaveBeenCalledWith("browser:tab-counts", expect.anything());

    await manager.closeTab(tab.id);
    expect(win.webContents.send).toHaveBeenCalledWith("browser:tab-counts", {});
  });

  it("promotes the next tab in the same scope when a feature's active tab closes", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const a1 = manager.createTab(undefined, "fresh", 1);
    const a2 = manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 2);

    await manager.closeTab(a2.id);

    // Closing feature 1's active tab falls back to feature 1's other tab, never
    // to feature 2's.
    expect(manager.state(1).tabs.map((t) => t.id)).toEqual([a1.id]);
    expect(manager.state(1).activeTabId).toBe(a1.id);
  });

  it("closes every tab in a scope in one pass, emitting state once", async () => {
    const win = mainWindow();
    const manager = new BrowserManager(() => win as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 1);
    const other = manager.createTab(undefined, "fresh", 2);
    win.webContents.send.mockClear();

    const snapshot = await manager.closeTabsForScope(1);

    // The whole scope is torn down; the other feature is untouched.
    expect(snapshot.tabs).toEqual([]);
    expect(manager.state(1).tabs).toEqual([]);
    expect(manager.state(2).tabs.map((t) => t.id)).toEqual([other.id]);
    // A single batched state push for the scope, not one per closed tab.
    const stateEmits = win.webContents.send.mock.calls.filter(
      ([channel]) => channel === "browser:state",
    );
    expect(stateEmits).toHaveLength(1);
  });

  it("keeps the unscoped (agent/MCP) view active after a scope's last tab closes", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const a = manager.createTab(undefined, "fresh", 1);
    const b = manager.createTab(undefined, "fresh", 2);

    // Closing feature 2's only tab (the most-recently active) must not strand
    // the unscoped view at null — it falls back to the surviving tab.
    expect(manager.state().activeTabId).toBe(b.id);
    await manager.closeTab(b.id);
    expect(manager.state().activeTabId).toBe(a.id);
  });

  it("reuses an explicitly shared scoped tab without changing its profile", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    contents.getURL.mockReturnValue("http://localhost:3000/start");

    await expect(manager.openUrl("http://localhost:3000/blocked", { scopeId: 1 })).rejects.toThrow(
      "not shared",
    );
    manager.site.setSharing(tab.id, "http://localhost:3000", true);

    const result = await manager.openUrl("http://localhost:3000/next", { scopeId: 1 });

    expect(result.id).toBe(tab.id);
    expect(result.sessionProfileId).toBe("fresh");
    expect(manager.state(1).tabs.map((t) => t.id)).toEqual([tab.id]);
    expect(contents.loadURL).toHaveBeenCalledWith("http://localhost:3000/next");
  });

  it("creates a scoped tab when opening a URL without an active tab", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);

    const result = await manager.openUrl("http://localhost:3000/first", { scopeId: 1 });

    expect(manager.state(1).activeTabId).toBe(result.id);
    expect(manager.state(1).tabs.map((t) => t.id)).toEqual([result.id]);
  });

  it("creates a new scoped tab when opening a URL with new_tab", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const first = manager.createTab(undefined, "fresh", 1);

    const second = await manager.openUrl("http://localhost:3000/second", {
      newTab: true,
      scopeId: 1,
    });

    expect(second.id).not.toBe(first.id);
    expect(manager.state(1).tabs.map((t) => t.id)).toEqual([first.id, second.id]);
    expect(manager.state(1).activeTabId).toBe(second.id);
  });

  it("keeps normal browsing on the existing persistent default partition", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);

    const tab = manager.createTab(undefined, "default", 1);

    expect(tab.sessionProfileId).toBe("default");
    expect(createdViews[0].partition).toBe("persist:browser:default");
  });

  it("gives separate top-level private tabs separate in-memory partitions", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);

    const first = manager.createTab(undefined, "fresh", 1);
    const second = manager.createTab(undefined, "fresh", 1);

    expect(first.sessionProfileId).toBe("fresh");
    expect(second.sessionProfileId).toBe("fresh");
    expect(createdViews[0].partition).toMatch(/^browser:fresh:/);
    expect(createdViews[1].partition).toMatch(/^browser:fresh:/);
    expect(createdViews[0].partition).not.toBe(createdViews[1].partition);
  });

  it("makes child private tabs inherit their parent's actual in-memory partition", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const parent = [...webContentsById.values()][0];
    const openChild = parent.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string;
    }) => unknown;

    openChild({ url: "https://example.com/child" });

    expect(createdViews).toHaveLength(2);
    expect(createdViews[1].partition).toBe(createdViews[0].partition);
    expect(manager.state(1).tabs.map((tab) => tab.sessionProfileId)).toEqual(["fresh", "fresh"]);
  });

  it("clears a shared private partition only when its last tab closes", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const parentMeta = manager.createTab(undefined, "fresh", 1);
    const parent = [...webContentsById.values()][0];
    const openChild = parent.setWindowOpenHandler.mock.calls[0][0] as (details: {
      url: string;
    }) => unknown;
    openChild({ url: "https://example.com/child" });
    const childMeta = manager.state(1).tabs.find((tab) => tab.id !== parentMeta.id);
    if (!childMeta) throw new Error("Expected child tab");
    const partition = createdViews[0].partition;
    if (!partition) throw new Error("Expected private partition");

    await manager.closeTab(parentMeta.id);
    expect(sessionsByPartition.has(partition)).toBe(false);

    await manager.closeTab(childMeta.id);
    const privateSession = sessionsByPartition.get(partition);
    expect(privateSession?.closeAllConnections).toHaveBeenCalledOnce();
    expect(privateSession?.clearData).toHaveBeenCalledOnce();
    expect(privateSession?.clearAuthCache).toHaveBeenCalledOnce();
  });

  it("clears every private partition when its feature scope closes", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 1);
    const partitions = createdViews.map((view) => view.partition);

    await manager.closeTabsForScope(1);

    for (const partition of partitions) {
      if (!partition) throw new Error("Expected private partition");
      expect(sessionsByPartition.get(partition)?.clearData).toHaveBeenCalledOnce();
    }
  });

  it("does not clear the persistent normal partition when its last tab closes", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "default", 1);

    await manager.closeTab(tab.id);

    expect(sessionsByPartition.has("persist:browser:default")).toBe(false);
  });

  it("does not record private navigations in persisted origin suggestions", () => {
    const record = vi.spyOn(BrowserOriginStore.prototype, "record").mockImplementation(() => {});
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const privateContents = [...webContentsById.values()][0];
    privateContents.getURL.mockReturnValue("https://private.example/path");

    privateContents.emit("did-navigate");
    expect(record).not.toHaveBeenCalled();

    manager.createTab(undefined, "default", 1);
    const normalContents = [...webContentsById.values()][1];
    normalContents.getURL.mockReturnValue("https://normal.example/path");
    normalContents.emit("did-navigate");
    expect(record).toHaveBeenCalledWith("https://normal.example/path");
  });

  it("materializes favicons through the guest session instead of exposing a remote URL", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    contents.getURL.mockReturnValue("https://private.example/page");

    contents.emit("page-favicon-updated", {}, ["https://private.example/favicon.png"]);

    await vi.waitFor(() =>
      expect(manager.state(1).tabs[0].faviconUrl).toBe("data:image/png;base64,iVBORw=="),
    );
    expect(contents.session.fetch).toHaveBeenCalledWith(
      "https://private.example/favicon.png",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("discards a favicon response from a stale navigation", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    contents.getURL.mockReturnValue("https://private.example/first");
    let finishFavicon: ((response: Response) => void) | undefined;
    contents.session.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishFavicon = resolve;
        }),
    );
    contents.emit("page-favicon-updated", {}, ["https://private.example/favicon.png"]);

    contents.getURL.mockReturnValue("https://private.example/second");
    contents.emit("did-start-loading");
    finishFavicon?.(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      }),
    );
    await vi.waitFor(() => expect(contents.session.fetch).toHaveBeenCalledOnce());
    await new Promise((resolve) => setImmediate(resolve));

    expect(manager.state(1).tabs[0].faviconUrl).toBeUndefined();
  });

  it("waits for native destruction before clearing a private partition", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    const partition = createdViews[0].partition;
    if (!partition) throw new Error("Expected private partition");
    contents.close.mockImplementation(() => undefined);

    const close = manager.closeTab(tab.id);
    await Promise.resolve();
    expect(sessionsByPartition.has(partition)).toBe(false);

    contents.isDestroyed.mockReturnValue(true);
    contents.emit("destroyed");
    await close;
    expect(sessionsByPartition.get(partition)?.clearData).toHaveBeenCalledOnce();
  });

  it("removes and clears a tab destroyed outside the manager", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    const partition = createdViews[0].partition;
    if (!partition) throw new Error("Expected private partition");

    contents.isDestroyed.mockReturnValue(true);
    contents.emit("destroyed");

    await vi.waitFor(() => expect(manager.state(1).tabs).toEqual([]));
    await vi.waitFor(() =>
      expect(sessionsByPartition.get(partition)?.clearData).toHaveBeenCalledOnce(),
    );
  });

  it("destroys a tab's DevTools contents before clearing its partition", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);
    manager.toggleDevTools(tab.id);
    const [guest, devtools] = [...webContentsById.values()];

    await manager.closeTab(tab.id);

    expect(devtools.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(guest.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    expect(createdViews[1].partition).toBe(createdViews[0].partition);
  });

  it("cleans a claimed private session when tab setup fails", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    failNetworkRegistration = true;

    expect(() => manager.createTab(undefined, "fresh", 1)).toThrow("network registration failed");

    const contents = [...webContentsById.values()][0];
    const partition = createdViews[0].partition;
    if (!partition) throw new Error("Expected private partition");
    expect(contents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false });
    await vi.waitFor(() =>
      expect(sessionsByPartition.get(partition)?.clearData).toHaveBeenCalledOnce(),
    );
    expect(manager.state(1).error).toContain("network registration failed");
  });

  it("waits for all scope cleanups before surfacing a cleanup failure", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    manager.createTab(undefined, "fresh", 1);
    manager.createTab(undefined, "fresh", 1);
    const [failedPartition, pendingPartition] = createdViews.map((view) => view.partition);
    if (!failedPartition || !pendingPartition) throw new Error("Expected private partitions");
    let finishPending: (() => void) | undefined;
    sessionsByPartition.set(failedPartition, {
      closeAllConnections: vi.fn(async () => undefined),
      clearData: vi.fn(async () => {
        throw new Error("clear failed");
      }),
      clearAuthCache: vi.fn(async () => undefined),
    });
    sessionsByPartition.set(pendingPartition, {
      closeAllConnections: vi.fn(async () => undefined),
      clearData: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPending = resolve;
          }),
      ),
      clearAuthCache: vi.fn(async () => undefined),
    });

    const closing = manager.closeTabsForScope(1);
    let settled = false;
    void closing.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.waitFor(() => expect(finishPending).toBeTypeOf("function"));
    expect(settled).toBe(false);
    finishPending?.();

    await expect(closing).rejects.toThrow("Browser session cleanup failed");
    expect(manager.state(1).error).toContain("Browser session cleanup failed");
  });

  it("drains an aborted favicon fetch before clearing private session data", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const tab = manager.createTab(undefined, "fresh", 1);
    const contents = [...webContentsById.values()][0];
    const partition = createdViews[0].partition;
    if (!partition) throw new Error("Expected private partition");
    contents.getURL.mockReturnValue("https://private.example/page");
    let finishFavicon: ((response: Response) => void) | undefined;
    contents.session.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishFavicon = resolve;
        }),
    );
    contents.emit("page-favicon-updated", {}, ["https://private.example/favicon.png"]);

    const closing = manager.closeTab(tab.id);
    await Promise.resolve();
    expect(sessionsByPartition.has(partition)).toBe(false);
    finishFavicon?.(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      }),
    );

    await closing;
    expect(sessionsByPartition.get(partition)?.clearData).toHaveBeenCalledOnce();
    expect(manager.state(1).tabs).toEqual([]);
  });

  it("restores only the active normal tab and leaves inactive metadata dormant", async () => {
    const saved: RestorableBrowserScope = {
      tabs: [
        { title: "Pinned", url: "https://one.example/", sessionProfileId: "default", pinned: true },
        { title: "Active", url: "https://two.example/", sessionProfileId: "work", pinned: false },
      ],
      activeIndex: 1,
    };
    const { store, loadScope } = tabSessionStore(saved);
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );

    const [first, second] = (await manager.restoreScope(7)).tabs;

    expect(loadScope).toHaveBeenCalledOnce();
    expect(createdViews).toHaveLength(1);
    expect(first).toMatchObject({ title: "Pinned", pinned: true, suspended: true });
    expect(second).toMatchObject({ title: "Active", isActive: true, suspended: false });
    expect(createdViews[0].partition).toBe("persist:browser:work");
  });

  it("does not reactivate a cached restored id after the scope was cleared", async () => {
    const { store, loadScope } = tabSessionStore({
      tabs: [
        {
          title: "Saved",
          url: "https://saved.example/",
          sessionProfileId: "default",
          pinned: false,
        },
      ],
      activeIndex: 0,
    });
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );

    await manager.restoreScope(8);
    await manager.closeTabsForScope(8);

    await expect(manager.restoreScope(8)).resolves.toMatchObject({ tabs: [], activeTabId: null });
    expect(loadScope).toHaveBeenCalledOnce();
  });

  it("retains dormant metadata when materialization fails so activation can retry", async () => {
    const { store } = tabSessionStore({
      tabs: [
        {
          title: "Active",
          url: "https://active.example/",
          sessionProfileId: "default",
          pinned: false,
        },
        {
          title: "Dormant",
          url: "https://dormant.example/",
          sessionProfileId: "work",
          pinned: false,
        },
      ],
      activeIndex: 0,
    });
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );
    const dormantId = (await manager.restoreScope(9)).tabs[1].id;
    failNetworkRegistration = true;

    await expect(manager.activateTab(dormantId)).rejects.toThrow("network registration failed");
    expect(manager.state(9).tabs.find((tab) => tab.id === dormantId)).toMatchObject({
      suspended: true,
    });

    failNetworkRegistration = false;
    await expect(manager.activateTab(dormantId)).resolves.toMatchObject({
      id: dormantId,
      suspended: false,
    });
  });

  it("rejects an invalid new URL without creating a phantom tab", async () => {
    const { store } = tabSessionStore();
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );
    await manager.restoreScope(10);

    expect(() => manager.createTab("javascript:alert(1)", "default", 10)).toThrow();

    expect(manager.state(10).tabs).toEqual([]);
    expect(manager.tabCountsByScope()).toEqual({});
    expect(createdViews).toHaveLength(0);
  });

  it("duplicates a private tab in the same session without inheriting agent sharing", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const original = manager.createTab(undefined, "fresh", 11);
    const originalContents = [...webContentsById.values()][0];
    originalContents.getURL.mockReturnValue("http://localhost:3000/");
    manager.site.setSharing(original.id, "http://localhost:3000", true);

    const duplicate = manager.duplicateTab(original.id);

    expect(createdViews[1].partition).toBe(createdViews[0].partition);
    expect(duplicate.pinned).toBe(false);
    expect(() => manager.automation.assert(duplicate.id, 11)).toThrow("not shared");
  });

  it("persists confirmed close-others removals even when private cleanup fails", async () => {
    const { store, replaceScope } = tabSessionStore();
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );
    await manager.restoreScope(12);
    const keep = manager.createTab("https://keep.example/", "default", 12);
    manager.createTab("https://remove.example/", "work", 12);
    manager.createTab(undefined, "fresh", 12);
    const privatePartition = createdViews[2].partition;
    if (!privatePartition) throw new Error("Expected private partition");
    sessionsByPartition.set(privatePartition, {
      closeAllConnections: vi.fn(async () => undefined),
      clearData: vi.fn(async () => {
        throw new Error("private cleanup failed");
      }),
      clearAuthCache: vi.fn(async () => undefined),
    });

    await expect(manager.closeOtherTabs(keep.id)).rejects.toThrow("Browser session cleanup failed");
    await manager.flushTabSessions();

    expect(manager.state(12).tabs.map((tab) => tab.id)).toEqual([keep.id]);
    expect(replaceScope).toHaveBeenLastCalledWith(12, {
      tabs: [
        {
          title: "New tab",
          url: "https://keep.example/",
          sessionProfileId: "default",
          pinned: false,
        },
      ],
      activeIndex: 0,
    });
  });

  it("reopens only normal tabs and consumes the stack after successful creation", async () => {
    const { store } = tabSessionStore();
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );
    await manager.restoreScope(13);
    const normal = manager.createTab("https://normal.example/", "default", 13);
    const privateTab = manager.createTab("https://private.example/", "fresh", 13);
    await manager.closeTab(privateTab.id);
    expect(manager.reopenLastClosedTab(13)).toBeNull();
    await manager.closeTab(normal.id);
    failNetworkRegistration = true;
    expect(() => manager.reopenLastClosedTab(13)).toThrow("network registration failed");
    failNetworkRegistration = false;

    expect(manager.reopenLastClosedTab(13)).toMatchObject({
      url: "https://normal.example/",
      sessionProfileId: "default",
    });
    expect(manager.reopenLastClosedTab(13)).toBeNull();
  });

  it("keeps per-scope active flags intact after an unscoped automation snapshot", () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const first = manager.createTab(undefined, "fresh", 21);
    const second = manager.createTab(undefined, "fresh", 22);

    expect(manager.state().activeTabId).toBe(second.id);

    expect(manager.state(21).tabs.find((tab) => tab.id === first.id)?.isActive).toBe(true);
    expect(manager.state(22).tabs.find((tab) => tab.id === second.id)?.isActive).toBe(true);
  });

  it("groups pinned tabs, bounds reorder within groups, and preserves pins on close others", async () => {
    const manager = new BrowserManager(() => mainWindow() as unknown as Electron.BrowserWindow);
    const first = manager.createTab(undefined, "default", 23);
    const second = manager.createTab(undefined, "default", 23);
    const pinnedPrivate = manager.createTab(undefined, "fresh", 23);
    manager.setTabPinned(pinnedPrivate.id, true);
    manager.setTabPinned(first.id, true);

    manager.reorderTab(first.id, Number.MAX_SAFE_INTEGER);
    expect(manager.state(23).tabs.map((tab) => tab.id)).toEqual([
      pinnedPrivate.id,
      first.id,
      second.id,
    ]);

    await manager.closeOtherTabs(first.id);
    expect(manager.state(23).tabs.map((tab) => tab.id)).toEqual([pinnedPrivate.id, first.id]);
  });

  it("persists the last normal active tab while a private tab is active", async () => {
    const { store, replaceScope } = tabSessionStore();
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );
    await manager.restoreScope(24);
    const first = manager.createTab("https://first.example/", "default", 24);
    manager.createTab("https://second.example/", "work", 24);
    await manager.activateTab(first.id);
    const privateTab = manager.createTab("https://secret.example/", "fresh", 24);
    manager.setTabPinned(privateTab.id, true);

    await manager.flushTabSessions();

    expect(replaceScope).toHaveBeenLastCalledWith(24, expect.objectContaining({ activeIndex: 0 }));
    const saved = replaceScope.mock.lastCall?.[1] as RestorableBrowserScope;
    expect(saved.tabs.map((tab) => tab.url)).toEqual([
      "https://first.example/",
      "https://second.example/",
    ]);
  });

  it("restores metadata-only before destructive scope close without creating a view", async () => {
    const { store } = tabSessionStore({
      tabs: [
        {
          title: "Saved",
          url: "https://saved.example/",
          sessionProfileId: "default",
          pinned: false,
        },
      ],
      activeIndex: 0,
    });
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );

    expect((await manager.restoreScopeMetadata(25)).tabs).toHaveLength(1);
    expect(createdViews).toHaveLength(0);
    await manager.closeTabsForScope(25);
    expect(createdViews).toHaveLength(0);
  });

  it("freezes persistence before native shutdown destruction can erase saved tabs", async () => {
    const { store, replaceScope } = tabSessionStore();
    const manager = new BrowserManager(
      () => mainWindow() as unknown as Electron.BrowserWindow,
      store,
    );
    await manager.restoreScope(26);
    manager.createTab("https://saved.example/", "default", 26);

    await manager.prepareForShutdown();
    const contents = [...webContentsById.values()][0];
    contents.isDestroyed.mockReturnValue(true);
    contents.emit("destroyed");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(replaceScope).toHaveBeenCalledOnce();
    expect(replaceScope.mock.lastCall?.[1]).toMatchObject({
      tabs: [{ url: "https://saved.example/" }],
    });
  });

  it("detaches live views for a window-only close and reattaches them to the next window", async () => {
    const oldWindow = mainWindow();
    const nextWindow = mainWindow();
    let currentWindow = oldWindow;
    const { store, replaceScope } = tabSessionStore();
    const manager = new BrowserManager(
      () => currentWindow as unknown as Electron.BrowserWindow,
      store,
    );
    await manager.restoreScope(27);
    const tab = manager.createTab("https://kept.example/", "default", 27);
    manager.setBounds({ x: 0, y: 0, width: 500, height: 300 }, 27);
    expect(oldWindow.contentView.addChildView).toHaveBeenCalledOnce();

    await manager.prepareForWindowClose();
    expect(oldWindow.contentView.removeChildView).toHaveBeenCalledOnce();
    currentWindow = nextWindow;
    manager.setBounds({ x: 0, y: 0, width: 500, height: 300 }, 27);

    expect(nextWindow.contentView.addChildView).toHaveBeenCalledOnce();
    expect(manager.state(27).tabs.map((item) => item.id)).toEqual([tab.id]);
    manager.navigate(tab.id, "https://updated.example/");
    await manager.flushTabSessions();
    expect(replaceScope.mock.lastCall?.[1]).toMatchObject({
      tabs: [{ url: "https://updated.example/" }],
    });
  });
});
