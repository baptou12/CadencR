import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BugIcon,
  CookieIcon,
  CornerDownLeftIcon,
  EyeOffIcon,
  GlobeIcon,
  LockIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  desktopBridge,
  type BrowserElementContext,
  type BrowserStateSnapshot,
  type BrowserTabMetadata,
} from "@/lib/desktop-bridge";
import { useBrowserViewportBounds } from "./useBrowserViewportBounds";

interface BrowserWorkspaceTabProps {
  onSendContext: (message: string, images?: Array<{ base64: string; mimeType: string }>) => void;
}

/** Two cookie modes the user can pick from. Normal reuses an on-disk profile; private is in-memory only. */
type CookieMode = "normal" | "private";

/** Profile id passed to the backend for each mode. "default" → persistent partition, "fresh" → ephemeral. */
const PROFILE_ID: Record<CookieMode, string> = { normal: "default", private: "fresh" };

const EMPTY_STATE: BrowserStateSnapshot = {
  tabs: [],
  activeTabId: null,
  consoleEntries: [],
  networkEntries: [],
  error: null,
};

interface BrowserWorkspaceModel {
  state: BrowserStateSnapshot;
  urlInput: string;
  mode: CookieMode;
  loading: boolean;
  pending: boolean;
  activeTab: BrowserTabMetadata | null;
  viewportRef: (node: HTMLDivElement | null) => void;
  setUrlInput: (value: string) => void;
  setMode: (mode: CookieMode) => void;
  clearError: () => void;
  navigate: (event: FormEvent) => Promise<void>;
  sendContext: () => Promise<void>;
  runForActive: (action: (tab: BrowserTabMetadata) => Promise<void>) => Promise<void>;
}

export const BrowserWorkspaceTab = memo(function BrowserWorkspaceTab({
  onSendContext,
}: BrowserWorkspaceTabProps): ReactElement {
  const model = useBrowserWorkspaceModel(onSendContext);
  if (model.loading) return <BrowserLoading />;
  return <BrowserWorkspaceView model={model} />;
});

function BrowserLoading(): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <GlobeIcon className="size-6 animate-pulse" />
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Loader2Icon className="size-4 animate-spin" /> Starting browser…
      </div>
    </div>
  );
}

function BrowserWorkspaceView({ model }: { model: BrowserWorkspaceModel }): ReactElement {
  const newTab = useCallback(
    () => void desktopBridge.createBrowserTab(undefined, PROFILE_ID[model.mode]).catch(reportError),
    [model.mode],
  );
  const activateTab = useCallback(
    (tabId: string): void => void desktopBridge.activateBrowserTab(tabId).catch(reportError),
    [],
  );
  const closeTab = useCallback(
    (tabId: string): void => void desktopBridge.closeBrowserTab(tabId).catch(reportError),
    [],
  );
  const back = useCallback(
    (): void => void model.runForActive((tab) => desktopBridge.browserBack(tab.id)),
    [model.runForActive],
  );
  const forward = useCallback(
    (): void => void model.runForActive((tab) => desktopBridge.browserForward(tab.id)),
    [model.runForActive],
  );
  const reload = useCallback(
    (): void => void model.runForActive((tab) => desktopBridge.browserReload(tab.id)),
    [model.runForActive],
  );
  const stop = useCallback(
    (): void => void model.runForActive((tab) => desktopBridge.browserStop(tab.id)),
    [model.runForActive],
  );
  const devTools = useCallback(
    (): void =>
      void model.runForActive((tab) =>
        desktopBridge.toggleBrowserDevTools(tab.id).then(() => undefined),
      ),
    [model.runForActive],
  );
  const sendContext = useCallback((): void => void model.sendContext(), [model.sendContext]);
  const visibleError = model.state.error;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <BrowserToolbar
        activeTab={model.activeTab}
        urlInput={model.urlInput}
        pending={model.pending}
        state={model.state}
        mode={model.mode}
        onModeChange={model.setMode}
        onUrlChange={model.setUrlInput}
        onNavigate={model.navigate}
        onNewTab={newTab}
        onActivate={activateTab}
        onCloseTab={closeTab}
        onBack={back}
        onForward={forward}
        onReload={reload}
        onStop={stop}
        onDevTools={devTools}
        onSendContext={sendContext}
      />
      {visibleError ? <BrowserError message={visibleError} onDismiss={model.clearError} /> : null}
      <div className="relative min-h-0 flex-1">
        {model.activeTab?.loading ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
            <div className="h-full w-1/3 animate-[browser-progress_1.1s_ease-in-out_infinite] bg-primary" />
          </div>
        ) : null}
        <div ref={model.viewportRef} className="h-full w-full" />
        {model.activeTab ? null : <BrowserEmptyState onNewTab={newTab} />}
      </div>
    </div>
  );
}

function BrowserEmptyState({ onNewTab }: { onNewTab: () => void }): ReactElement {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <GlobeIcon className="size-7" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">No browser tab open</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Open a tab to preview your app, then send the page context straight to the agent.
        </p>
      </div>
      <Button size="sm" onClick={onNewTab}>
        <PlusIcon className="size-4" />
        New tab
      </Button>
    </div>
  );
}

function useBrowserWorkspaceModel(
  onSendContext: BrowserWorkspaceTabProps["onSendContext"],
): BrowserWorkspaceModel {
  const [state, setState] = useState<BrowserStateSnapshot>(EMPTY_STATE);
  const [urlInput, setUrlInput] = useState("localhost:1420");
  const [mode, setMode] = useState<CookieMode>("normal");
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const viewportRef = useBrowserViewportBounds(reportError);
  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null,
    [state.activeTabId, state.tabs],
  );
  useBrowserBootstrap({ setState, setUrlInput, setLoading });
  const runForActive = useRunForActive(activeTab, setPending);
  const visibleState = useMemo(
    () => ({
      ...state,
      error: state.error === dismissedError ? null : state.error,
    }),
    [dismissedError, state],
  );
  const navigate = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      setDismissedError(null);
      await runForActive((tab) =>
        desktopBridge.navigateBrowserTab(tab.id, urlInput).then(() => undefined),
      );
    },
    [runForActive, urlInput],
  );
  const clearError = useCallback((): void => {
    if (state.error) setDismissedError(state.error);
  }, [state.error]);
  const sendContext = useSendContext(runForActive, onSendContext);
  return useMemo(
    () => ({
      state: visibleState,
      urlInput,
      mode,
      loading,
      pending,
      activeTab,
      viewportRef,
      setUrlInput,
      setMode,
      clearError,
      navigate,
      sendContext,
      runForActive,
    }),
    [
      activeTab,
      clearError,
      loading,
      mode,
      navigate,
      pending,
      runForActive,
      sendContext,
      urlInput,
      viewportRef,
      visibleState,
    ],
  );
}

interface BrowserBootstrapArgs {
  setState: (state: BrowserStateSnapshot) => void;
  setUrlInput: (value: string) => void;
  setLoading: (value: boolean) => void;
}

function useBrowserBootstrap(args: BrowserBootstrapArgs): void {
  const { setState, setUrlInput, setLoading } = args;
  useEffect(() => {
    let alive = true;
    void desktopBridge
      .listBrowserTabs()
      .then(async (snapshot) => {
        if (!alive) return;
        if (snapshot.tabs.length > 0) {
          setState(snapshot);
          setUrlInput(snapshot.tabs.find((tab) => tab.isActive)?.url ?? snapshot.tabs[0].url);
          return;
        }
        await desktopBridge.createBrowserTab(undefined, PROFILE_ID.normal);
      })
      .catch((error: unknown) => showError(error, "Browser unavailable"))
      .finally(() => alive && setLoading(false));
    const off = desktopBridge.onBrowserState((next) => {
      setState(next);
      const active = next.tabs.find((tab) => tab.id === next.activeTabId);
      if (active) setUrlInput(active.url);
    });
    return () => {
      alive = false;
      off();
    };
  }, [setLoading, setState, setUrlInput]);
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
        showError(error, "Browser action failed");
      } finally {
        setPending(false);
      }
    },
    [activeTab, setPending],
  );
}

function useSendContext(
  runForActive: BrowserWorkspaceModel["runForActive"],
  onSendContext: BrowserWorkspaceTabProps["onSendContext"],
): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    await runForActive(async (tab) => {
      const context = await desktopBridge.selectBrowserElementContext(tab.id);
      onSendContext(formatElementContext(context), [
        { base64: context.screenshotPngBase64, mimeType: "image/png" },
      ]);
      toast.success("Browser context sent to the active agent.");
    });
  }, [onSendContext, runForActive]);
}

interface ToolbarProps {
  activeTab: BrowserTabMetadata | null;
  urlInput: string;
  pending: boolean;
  state: BrowserStateSnapshot;
  mode: CookieMode;
  onModeChange: (mode: CookieMode) => void;
  onUrlChange: (value: string) => void;
  onNavigate: (event: FormEvent) => Promise<void>;
  onNewTab: () => void;
  onActivate: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onStop: () => void;
  onDevTools: () => void;
  onSendContext: () => void;
}

const BrowserToolbar = memo(function BrowserToolbar(props: ToolbarProps): ReactElement {
  return (
    <div className="relative flex shrink-0 flex-col gap-1.5 border-b bg-card/95 px-2 pb-2 pt-1.5 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <BrowserTabStrip {...props} />
      <BrowserAddressBar {...props} />
    </div>
  );
});

function BrowserTabStrip(props: ToolbarProps): ReactElement {
  return (
    <div className="flex items-center gap-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {props.state.tabs.map((tab) => (
          <BrowserTabPill
            key={tab.id}
            tab={tab}
            onActivate={props.onActivate}
            onClose={props.onCloseTab}
          />
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={props.onNewTab}
          aria-label="New browser tab"
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <BrowserModeToggle mode={props.mode} onModeChange={props.onModeChange} />
    </div>
  );
}

function BrowserModeToggle({
  mode,
  onModeChange,
}: {
  mode: CookieMode;
  onModeChange: (mode: CookieMode) => void;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label="Cookie mode"
      className="ml-auto flex shrink-0 items-center rounded-md border bg-muted/50 p-0.5"
    >
      <BrowserModeButton
        active={mode === "normal"}
        icon={CookieIcon}
        label="Normal"
        title="Reuse existing cookies and logins"
        onClick={() => onModeChange("normal")}
      />
      <BrowserModeButton
        active={mode === "private"}
        icon={EyeOffIcon}
        label="Private"
        title="Start fresh with no cookies"
        onClick={() => onModeChange("private")}
      />
    </div>
  );
}

function BrowserModeButton({
  active,
  icon: Icon,
  label,
  title,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  title: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${active ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

function BrowserTabPill({
  tab,
  onActivate,
  onClose,
}: {
  tab: BrowserTabMetadata;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}): ReactElement {
  return (
    <div
      className={`group/tab flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md pl-2 pr-1 text-xs transition-colors ${tab.isActive ? "bg-background text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"}`}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5"
        onClick={() => onActivate(tab.id)}
        title={tab.title || tab.url}
      >
        <BrowserTabIcon tab={tab} />
        <span className="truncate">{tab.title || "New tab"}</span>
      </button>
      <button
        type="button"
        aria-label="Close tab"
        className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-muted-foreground/20 group-hover/tab:opacity-100"
        onClick={() => onClose(tab.id)}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

function BrowserTabIcon({ tab }: { tab: BrowserTabMetadata }): ReactElement {
  if (tab.loading) return <Loader2Icon className="size-3.5 shrink-0 animate-spin text-primary" />;
  if (tab.sessionProfileId === PROFILE_ID.private)
    return <EyeOffIcon className="size-3.5 shrink-0 opacity-70" aria-label="Private tab" />;
  return <GlobeIcon className="size-3.5 shrink-0 opacity-70" />;
}

function BrowserAddressBar(props: ToolbarProps): ReactElement {
  const secure = isSecureUrl(props.activeTab?.url);
  return (
    <form className="flex items-center gap-1.5" onSubmit={(event) => void props.onNavigate(event)}>
      <div className="flex shrink-0 items-center rounded-md bg-muted/50 p-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!props.activeTab?.canGoBack}
          onClick={props.onBack}
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={!props.activeTab?.canGoForward}
          onClick={props.onForward}
          aria-label="Forward"
        >
          <ArrowRightIcon className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={props.activeTab?.loading ? props.onStop : props.onReload}
          aria-label={props.activeTab?.loading ? "Stop" : "Reload"}
        >
          {props.activeTab?.loading ? (
            <SquareIcon className="size-4" />
          ) : (
            <RefreshCwIcon className="size-4" />
          )}
        </Button>
      </div>
      <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-transparent bg-muted px-2.5 transition-colors focus-within:border-primary focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/20">
        {secure ? (
          <LockIcon className="size-3.5 shrink-0 text-[var(--acc-green)]" aria-label="Secure" />
        ) : (
          <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Not secure" />
        )}
        <Input
          aria-label="Browser URL"
          variant="ghost"
          value={props.urlInput}
          onChange={(event) => props.onUrlChange(event.target.value)}
          placeholder="Search or enter address"
          className="h-7 flex-1 font-mono text-xs"
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          disabled={props.pending}
          aria-label="Go"
          className="text-muted-foreground hover:text-foreground"
        >
          {props.pending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <CornerDownLeftIcon className="size-3" />
          )}
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={props.onDevTools}
        aria-label="DevTools"
      >
        <BugIcon className="size-4" />
      </Button>
      <Button type="button" size="sm" className="shrink-0" onClick={props.onSendContext}>
        <SparklesIcon className="size-3.5" />
        Send context
      </Button>
    </form>
  );
}

function BrowserError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): ReactElement {
  return (
    <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertTriangleIcon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        aria-label="Dismiss browser error"
        className="rounded p-1 hover:bg-destructive/15"
        onClick={onDismiss}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

function isSecureUrl(rawUrl?: string): boolean {
  if (!rawUrl) return false;
  try {
    return new URL(rawUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function formatElementContext(context: BrowserElementContext): string {
  return `Browser element context\nURL: ${context.url}\nTitle: ${context.title}\nSelectors: ${context.element.selectorCandidates.join(", ")}\nText: ${context.element.textPreview ?? ""}`;
}

function showError(error: unknown, title: string): void {
  const message = error instanceof Error ? error.message : String(error);
  toast.error(title, { description: message });
}

function reportError(error: unknown): void {
  showError(error, "Browser action failed");
}
