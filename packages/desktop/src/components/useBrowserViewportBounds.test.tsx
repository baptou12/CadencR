import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, type ReactElement } from "react";
import { useBrowserViewportBounds } from "./useBrowserViewportBounds";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
  type CadencrBrowserBridge,
} from "@/lib/desktop-bridge";

let animationFrameCallbacks: Array<FrameRequestCallback> = [];

function TestViewport({ visible }: { visible: boolean }): ReactElement | null {
  const ref = useBrowserViewportBounds(() => undefined);
  const assignRef = useCallback((node: HTMLDivElement | null): void => ref(node), [ref]);
  return visible ? <div data-testid="viewport" ref={assignRef} /> : null;
}

function bridge(): CadencrBrowserBridge {
  return {
    isElectron: true,
    runtimeConfig: vi.fn(),
    readFileBase64: vi.fn(),
    onFileDrop: vi.fn(() => () => undefined),
    revealInFinder: vi.fn(),
    openExternal: vi.fn(),
    pickDirectory: vi.fn(),
    showSaveDialog: vi.fn(),
    notifyPermission: vi.fn(),
    notify: vi.fn(),
    notifyTest: vi.fn(),
    onNotificationClicked: vi.fn(() => () => undefined),
    onNotificationFailed: vi.fn(() => () => undefined),
    onNotificationFallback: vi.fn(() => () => undefined),
    onCloseRequested: vi.fn(() => () => undefined),
    confirmClose: vi.fn(),
    requestQuit: vi.fn(),
    setZoom: vi.fn(),
    currentTheme: vi.fn(),
    onThemeChange: vi.fn(() => () => undefined),
    setBusy: vi.fn(),
    setRemoteHostAwake: vi.fn(),
    onPowerSuspend: vi.fn(() => () => undefined),
    onPowerResume: vi.fn(() => () => undefined),
    createBrowserTab: vi.fn(),
    listBrowserTabs: vi.fn(),
    navigateBrowserTab: vi.fn(),
    activateBrowserTab: vi.fn(),
    closeBrowserTab: vi.fn(),
    setBrowserBounds: vi.fn(() =>
      Promise.resolve({
        tabs: [],
        activeTabId: null,
        consoleEntries: [],
        networkEntries: [],
        error: null,
      }),
    ),
    listBrowserProfiles: vi.fn(),
    clearBrowserStorage: vi.fn(),
    createBrowserProfile: vi.fn(),
    duplicateBrowserProfile: vi.fn(),
    deleteBrowserProfile: vi.fn(),
    browserBack: vi.fn(),
    browserForward: vi.fn(),
    browserReload: vi.fn(),
    browserStop: vi.fn(),
    toggleBrowserDevTools: vi.fn(),
    getBrowserConsole: vi.fn(),
    getBrowserNetwork: vi.fn(),
    getBrowserSnapshot: vi.fn(),
    getBrowserScreenshot: vi.fn(),
    browserClick: vi.fn(),
    browserType: vi.fn(),
    browserKeypress: vi.fn(),
    selectBrowserElementContext: vi.fn(),
    onBrowserState: vi.fn(() => () => undefined),
    checkForUpdates: vi.fn(),
    installUpdate: vi.fn(),
    fetchChangelog: vi.fn(),
    onUpdateEvent: vi.fn(() => () => undefined),
  };
}

function flushAnimationFrames(): void {
  const callbacks = animationFrameCallbacks;
  animationFrameCallbacks = [];
  for (const callback of callbacks) callback(0);
}

describe("useBrowserViewportBounds", () => {
  beforeEach(() => {
    animationFrameCallbacks = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrameCallbacks.push(callback);
        return animationFrameCallbacks.length;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => ({
        x: 12,
        y: 34,
        width: 640,
        height: 360,
        top: 34,
        left: 12,
        right: 652,
        bottom: 394,
        toJSON: () => ({}),
      })),
    });
  });

  afterEach(() => {
    clearDesktopBridgeOverrideForTests();
    vi.unstubAllGlobals();
  });

  it("reports initial bounds without a permanent animation-frame loop", async () => {
    const mockBridge = bridge();
    setDesktopBridgeOverrideForTests(mockBridge);

    render(<TestViewport visible />);

    flushAnimationFrames();

    await waitFor(() => {
      expect(mockBridge.setBrowserBounds).toHaveBeenCalledWith({
        x: 12,
        y: 34,
        width: 640,
        height: 360,
      });
    });
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    flushAnimationFrames();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it("disconnects observers and zeroes native bounds when unmounted", async () => {
    const mockBridge = bridge();
    setDesktopBridgeOverrideForTests(mockBridge);
    const { rerender } = render(<TestViewport visible />);

    rerender(<TestViewport visible={false} />);

    await waitFor(() => {
      expect(mockBridge.setBrowserBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 0, height: 0 });
    });
  });
});
