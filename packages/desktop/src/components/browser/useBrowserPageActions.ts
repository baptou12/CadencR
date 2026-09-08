import { useCallback, useMemo } from "react";

import { desktopBridge, type BrowserTabMetadata } from "@/lib/desktop-bridge";

export interface BrowserPageActions {
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  devTools: () => void;
}

export function useBrowserPageActions(
  runForActive: (action: (tab: BrowserTabMetadata) => Promise<void>) => Promise<void>,
): BrowserPageActions {
  const bridgeAction = useCallback(
    (action: (tabId: string) => Promise<void>): void => void runForActive((tab) => action(tab.id)),
    [runForActive],
  );
  const back = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserBack(tabId)),
    [bridgeAction],
  );
  const forward = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserForward(tabId)),
    [bridgeAction],
  );
  const reload = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserReload(tabId)),
    [bridgeAction],
  );
  const stop = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserStop(tabId)),
    [bridgeAction],
  );
  const zoomIn = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserZoomIn(tabId)),
    [bridgeAction],
  );
  const zoomOut = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserZoomOut(tabId)),
    [bridgeAction],
  );
  const zoomReset = useCallback(
    () => bridgeAction((tabId) => desktopBridge.browserZoomReset(tabId)),
    [bridgeAction],
  );
  const devTools = useCallback(
    (): void =>
      void runForActive((tab) => desktopBridge.toggleBrowserDevTools(tab.id).then(() => undefined)),
    [runForActive],
  );
  return useMemo(
    () => ({ back, forward, reload, stop, zoomIn, zoomOut, zoomReset, devTools }),
    [back, devTools, forward, reload, stop, zoomIn, zoomOut, zoomReset],
  );
}
