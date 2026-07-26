import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  desktopBridge,
  type BrowserStateSnapshot,
  type BrowserTabMetadata,
} from "@/lib/desktop-bridge";
import { PROFILE_ID, type CookieMode } from "@/lib/browser-settings";
import { useBrowserStore } from "@/stores/browser-store";
import { useBrowserViewportBounds } from "../useBrowserViewportBounds";
import { reportBrowserError, showBrowserError } from "./browser-errors";

const EMPTY_STATE: BrowserStateSnapshot = {
  tabs: [],
  activeTabId: null,
  consoleEntries: [],
  networkEntries: [],
  knownOrigins: [],
  error: null,
};

export interface BrowserWorkspaceModel {
  state: BrowserStateSnapshot;
  urlInput: string;
  mode: CookieMode;
  loading: boolean;
  pending: boolean;
  activeTab: BrowserTabMetadata | null;
  knownOrigins: string[];
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  viewportRef: (node: HTMLDivElement | null) => void;
  setUrlInput: (value: string) => void;
  setUrlEditing: (editing: boolean) => void;
  setMode: (mode: CookieMode) => void;
  clearError: () => void;
  focusUrlBar: () => void;
  navigate: (url: string) => Promise<void>;
  newTab: () => Promise<void>;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeActiveTab: () => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  devTools: () => void;
  runForActive: (action: (tab: BrowserTabMetadata) => Promise<void>) => Promise<void>;
}

// A blank tab shows an empty, focusable address bar rather than "about:blank".
function displayUrl(url: string): string {
  return url === "about:blank" ? "" : url;
}

type BrowserTabActions = Pick<
  BrowserWorkspaceModel,
  "navigate" | "newTab" | "activateTab" | "closeTab" | "closeActiveTab"
>;

function useBrowserTabActions(
  activeTab: BrowserTabMetadata | null,
  mode: CookieMode,
  scopeId: number,
  runForActive: BrowserWorkspaceModel["runForActive"],
  setUrlInput: (url: string) => void,
  focusUrlBar: () => void,
  setDismissedError: (error: string | null) => void,
): BrowserTabActions {
  const navigate = useCallback(
    async (url: string): Promise<void> => {
      setDismissedError(null);
      if (!activeTab) {
        try {
          await desktopBridge.createBrowserTab(url, PROFILE_ID[mode], scopeId);
        } catch (error) {
          showBrowserError(error, "Could not open a new tab");
        }
        return;
      }
      await runForActive((tab) =>
        desktopBridge.navigateBrowserTab(tab.id, url).then(() => undefined),
      );
    },
    [activeTab, mode, runForActive, scopeId, setDismissedError],
  );
  const newTab = useCallback(async (): Promise<void> => {
    try {
      await desktopBridge.createBrowserTab(undefined, PROFILE_ID[mode], scopeId);
      setUrlInput("");
      requestAnimationFrame(focusUrlBar);
    } catch (error) {
      showBrowserError(error, "Could not open a new tab");
    }
  }, [focusUrlBar, mode, scopeId, setUrlInput]);
  const activateTab = useCallback(
    (tabId: string): void => void desktopBridge.activateBrowserTab(tabId).catch(reportBrowserError),
    [],
  );
  const closeTab = useCallback(
    (tabId: string): void => void desktopBridge.closeBrowserTab(tabId).catch(reportBrowserError),
    [],
  );
  const closeActiveTab = useCallback((): void => {
    if (activeTab) closeTab(activeTab.id);
  }, [activeTab, closeTab]);
  return useMemo(
    () => ({ navigate, newTab, activateTab, closeTab, closeActiveTab }),
    [activateTab, closeActiveTab, closeTab, navigate, newTab],
  );
}

type BrowserPageActions = Pick<
  BrowserWorkspaceModel,
  "back" | "forward" | "reload" | "stop" | "zoomIn" | "zoomOut" | "devTools"
>;

function useBrowserPageActions(
  runForActive: BrowserWorkspaceModel["runForActive"],
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
  const devTools = useCallback(
    (): void =>
      void runForActive((tab) => desktopBridge.toggleBrowserDevTools(tab.id).then(() => undefined)),
    [runForActive],
  );
  return useMemo(
    () => ({ back, forward, reload, stop, zoomIn, zoomOut, devTools }),
    [back, devTools, forward, reload, stop, zoomIn, zoomOut],
  );
}

export function useBrowserWorkspaceModel(
  defaultMode: CookieMode,
  scopeId: number,
): BrowserWorkspaceModel {
  const [state, setState] = useState<BrowserStateSnapshot>(EMPTY_STATE);
  const [urlInput, setUrlInput] = useState("localhost:1420");
  const [mode, setMode] = useState<CookieMode>(defaultMode);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const urlEditingRef = useRef(false);
  const viewportRef = useBrowserViewportBounds(scopeId, reportBrowserError);

  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    [state.activeTabId, state.tabs],
  );
  const setUrlEditing = useCallback((editing: boolean): void => {
    urlEditingRef.current = editing;
  }, []);
  useBrowserBootstrap({
    setState,
    setUrlInput,
    setLoading,
    urlEditingRef,
    urlInputRef,
    defaultMode,
    scopeId,
  });
  const runForActive = useRunForActive(activeTab, setPending);

  const visibleState = useMemo<BrowserStateSnapshot>(
    () => ({ ...state, error: state.error === dismissedError ? null : state.error }),
    [dismissedError, state],
  );

  const focusUrlBar = useCallback((): void => {
    const input = urlInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const tabActions = useBrowserTabActions(
    activeTab,
    mode,
    scopeId,
    runForActive,
    setUrlInput,
    focusUrlBar,
    setDismissedError,
  );
  const pageActions = useBrowserPageActions(runForActive);
  const clearError = useCallback((): void => {
    if (state.error) setDismissedError(state.error);
  }, [state.error]);

  return useBrowserModelValue({
    activeTab,
    activateTab: tabActions.activateTab,
    back: pageActions.back,
    clearError,
    closeActiveTab: tabActions.closeActiveTab,
    closeTab: tabActions.closeTab,
    devTools: pageActions.devTools,
    focusUrlBar,
    forward: pageActions.forward,
    loading,
    mode,
    navigate: tabActions.navigate,
    newTab: tabActions.newTab,
    pending,
    reload: pageActions.reload,
    runForActive,
    setMode,
    setUrlEditing,
    setUrlInput,
    state: visibleState,
    stop: pageActions.stop,
    zoomIn: pageActions.zoomIn,
    zoomOut: pageActions.zoomOut,
    urlInput,
    urlInputRef,
    viewportRef,
    knownOrigins: state.knownOrigins,
  });
}

function useBrowserModelValue(model: BrowserWorkspaceModel): BrowserWorkspaceModel {
  return useMemo(
    () => model,
    [
      model.activeTab,
      model.activateTab,
      model.back,
      model.clearError,
      model.closeActiveTab,
      model.closeTab,
      model.devTools,
      model.focusUrlBar,
      model.forward,
      model.knownOrigins,
      model.loading,
      model.mode,
      model.navigate,
      model.newTab,
      model.pending,
      model.reload,
      model.runForActive,
      model.setUrlEditing,
      model.stop,
      model.zoomIn,
      model.zoomOut,
      model.state,
      model.urlInput,
      model.viewportRef,
    ],
  );
}

interface BrowserBootstrapArgs {
  setState: (state: BrowserStateSnapshot) => void;
  setUrlInput: (value: string) => void;
  setLoading: (value: boolean) => void;
  urlEditingRef: React.RefObject<boolean>;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  defaultMode: CookieMode;
  scopeId: number;
}

function useBrowserBootstrap(args: BrowserBootstrapArgs): void {
  const { setState, setUrlInput, setLoading, urlEditingRef, urlInputRef, defaultMode, scopeId } =
    args;
  // The default mode only seeds the very first tab; read it through a ref so a
  // later settings change (this tab can stay mounted in the background) doesn't
  // re-run the bootstrap and re-subscribe the state listener.
  const defaultModeRef = useRef(defaultMode);
  defaultModeRef.current = defaultMode;
  useEffect(() => {
    let alive = true;
    // True whenever the user is interacting with the address bar. The editing
    // ref can momentarily flip false on a transient blur (e.g. the native view
    // detach churns focus); the live focus check keeps a stray browser:state
    // event from replacing what the user is typing.
    const isUrlBarActive = (): boolean =>
      urlEditingRef.current || document.activeElement === urlInputRef.current;
    const applySnapshot = (next: BrowserStateSnapshot): void => {
      setState(next);
      useBrowserStore.getState().setSnapshot(next);
    };
    void desktopBridge
      .listBrowserTabs(scopeId)
      .then(async (snapshot) => {
        if (!alive) return;
        if (snapshot.tabs.length > 0) {
          applySnapshot(snapshot);
          const active = snapshot.tabs.find((tab) => tab.isActive) ?? snapshot.tabs[0];
          if (!isUrlBarActive()) setUrlInput(displayUrl(active.url));
          return;
        }
        await desktopBridge.createBrowserTab(
          undefined,
          PROFILE_ID[defaultModeRef.current],
          scopeId,
        );
      })
      .catch((error: unknown) => showBrowserError(error, "Browser unavailable"))
      .finally(() => alive && setLoading(false));
    const off = desktopBridge.onBrowserState((next) => {
      // The main process broadcasts one snapshot per feature scope; keep only
      // the one for this workspace so another feature's tabs never appear here.
      if (next.scopeId !== scopeId) return;
      applySnapshot(next);
      const active = next.tabs.find((tab) => tab.id === next.activeTabId);
      if (active && !isUrlBarActive()) setUrlInput(displayUrl(active.url));
    });
    return () => {
      alive = false;
      off();
      useBrowserStore.getState().setSnapshot(EMPTY_STATE);
    };
  }, [scopeId, setLoading, setState, setUrlInput, urlEditingRef, urlInputRef]);
}

function useRunForActive(
  activeTab: BrowserTabMetadata | null,
  setPending: (pending: boolean) => void,
): BrowserWorkspaceModel["runForActive"] {
  return useCallback(
    async (action: (tab: BrowserTabMetadata) => Promise<void>): Promise<void> => {
      if (!activeTab) return;
      setPending(true);
      try {
        await action(activeTab);
      } catch (error) {
        showBrowserError(error, "Browser action failed");
      } finally {
        setPending(false);
      }
    },
    [activeTab, setPending],
  );
}
