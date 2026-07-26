import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ForwardedRef,
  type MutableRefObject,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import type { Terminal } from "@xterm/xterm";
import { useLinkRouting } from "@/components/links/LinkRoutingContext";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";
import { isResizing, subscribeResize } from "@/lib/resize-coordinator";
import { toControlChar } from "@/lib/terminal-keys";
import { createXtermInstance } from "./createXtermInstance";
import type { XTermInstanceHandle, XTermInstanceProps } from "./XTermInstance.types";
import { useXTermImperativeHandle } from "./useXTermImperativeHandle";
import { attachXtermNavigationKeys } from "./xtermNavigationKeys";
import { attachTouchScroll } from "./xtermTouchScroll";

type RefValue<T> = MutableRefObject<T>;
type LinkRouting = ReturnType<typeof useLinkRouting>;

interface XTermRefs {
  containerRef: RefValue<HTMLDivElement | null>;
  terminalRef: RefValue<Terminal | null>;
  fitAddonRef: RefValue<FitAddon | null>;
  ptyIdRef: RefValue<string | null>;
  mountedRef: RefValue<boolean>;
  exitedRef: RefValue<boolean>;
  shouldKillRef: RefValue<boolean>;
  openedRef: RefValue<boolean>;
  pendingFocusRef: RefValue<boolean>;
  onTerminalFocusRef: RefValue<XTermInstanceProps["onTerminalFocus"]>;
  initialCommandRef: RefValue<XTermInstanceProps["initialCommand"]>;
  onInitialCommandConsumedRef: RefValue<XTermInstanceProps["onInitialCommandConsumed"]>;
  initialNoticeRef: RefValue<XTermInstanceProps["initialNotice"]>;
  onInitialNoticeConsumedRef: RefValue<XTermInstanceProps["onInitialNoticeConsumed"]>;
  ctrlArmedRef: RefValue<boolean>;
  onConsumeCtrlRef: RefValue<XTermInstanceProps["onConsumeCtrl"]>;
  linkRoutingRef: RefValue<LinkRouting>;
  writeRef: RefValue<((data: string) => void) | null>;
  resizeRef: RefValue<((cols: number, rows: number) => void) | null>;
  killRef: RefValue<(() => void) | null>;
  connectRef: RefValue<((cols: number, rows: number) => void) | null>;
}

function useXTermRefs(props: XTermInstanceProps): XTermRefs {
  const linkRouting = useLinkRouting();
  const refs = {
    containerRef: useRef<HTMLDivElement>(null),
    terminalRef: useRef<Terminal | null>(null),
    fitAddonRef: useRef<FitAddon | null>(null),
    ptyIdRef: useRef<string | null>(props.existingPtyId ?? null),
    mountedRef: useRef(true),
    exitedRef: useRef(false),
    shouldKillRef: useRef(props.killOnUnmount ?? false),
    openedRef: useRef(false),
    pendingFocusRef: useRef(false),
    onTerminalFocusRef: useRef(props.onTerminalFocus),
    initialCommandRef: useRef(props.initialCommand),
    onInitialCommandConsumedRef: useRef(props.onInitialCommandConsumed),
    initialNoticeRef: useRef(props.initialNotice),
    onInitialNoticeConsumedRef: useRef(props.onInitialNoticeConsumed),
    ctrlArmedRef: useRef(props.ctrlArmed ?? false),
    onConsumeCtrlRef: useRef(props.onConsumeCtrl),
    linkRoutingRef: useRef(linkRouting),
    writeRef: useRef<((data: string) => void) | null>(null),
    resizeRef: useRef<((cols: number, rows: number) => void) | null>(null),
    killRef: useRef<(() => void) | null>(null),
    connectRef: useRef<((cols: number, rows: number) => void) | null>(null),
  };
  const stableRefsRef = useRef<XTermRefs | null>(null);
  stableRefsRef.current ??= refs;
  const stableRefs = stableRefsRef.current;
  stableRefs.shouldKillRef.current = props.killOnUnmount ?? false;
  stableRefs.onTerminalFocusRef.current = props.onTerminalFocus;
  stableRefs.initialCommandRef.current = props.initialCommand;
  stableRefs.onInitialCommandConsumedRef.current = props.onInitialCommandConsumed;
  stableRefs.initialNoticeRef.current = props.initialNotice;
  stableRefs.onInitialNoticeConsumedRef.current = props.onInitialNoticeConsumed;
  stableRefs.ctrlArmedRef.current = props.ctrlArmed ?? false;
  stableRefs.onConsumeCtrlRef.current = props.onConsumeCtrl;
  stableRefs.linkRoutingRef.current = linkRouting;
  return stableRefs;
}

function useXTermConnection(props: XTermInstanceProps, refs: XTermRefs) {
  const onData = useCallback(
    (data: string): void => {
      if (refs.mountedRef.current) refs.terminalRef.current?.write(data);
    },
    [refs.mountedRef, refs.terminalRef],
  );
  const onReady = useCallback(
    (ptyId: string, cwd: string): void => {
      if (!refs.mountedRef.current) {
        refs.killRef.current?.();
        return;
      }
      refs.ptyIdRef.current = ptyId;
      props.onPtyReady?.(ptyId, cwd);
      const notice = refs.initialNoticeRef.current;
      if (notice) {
        refs.terminalRef.current?.write(`\x1b[90m→ cd ${notice}\x1b[0m\r\n`);
        refs.onInitialNoticeConsumedRef.current?.();
      }
      const command = refs.initialCommandRef.current;
      if (!command) return;
      setTimeout(() => {
        if (refs.mountedRef.current && refs.ptyIdRef.current) refs.writeRef.current?.(command);
        refs.onInitialCommandConsumedRef.current?.();
      }, 150);
    },
    [props.onPtyReady, refs],
  );
  const onExit = useCallback(
    (code: number): void => {
      if (!refs.mountedRef.current) return;
      refs.exitedRef.current = true;
      const id = refs.ptyIdRef.current;
      refs.terminalRef.current?.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
      if (id) props.onExit?.(id);
    },
    [props.onExit, refs],
  );
  const onReconnected = useCallback(
    (scrollback: string, alive: boolean, cwd: string | null): void => {
      if (!refs.mountedRef.current) return;
      const id = refs.ptyIdRef.current;
      if (!alive) {
        refs.exitedRef.current = true;
        refs.terminalRef.current?.write("\r\n\x1b[90m[Terminal session ended]\x1b[0m\r\n");
        if (id) props.onExit?.(id);
        return;
      }
      if (id) props.onPtyReady?.(id, cwd);
      refs.terminalRef.current?.write("\r\n\x1b[32m[Terminal reconnected]\x1b[0m\r\n");
      if (scrollback) refs.terminalRef.current?.write(scrollback);
      try {
        refs.fitAddonRef.current?.fit();
        const terminal = refs.terminalRef.current;
        if (terminal) refs.resizeRef.current?.(terminal.cols, terminal.rows);
      } catch {
        // Resize errors during reconnect are non-fatal.
      }
    },
    [props.onExit, props.onPtyReady, refs],
  );
  const onError = useCallback(
    (message: string): void => {
      if (refs.mountedRef.current) {
        refs.terminalRef.current?.write(`\r\n\x1b[31m[${message}]\x1b[0m\r\n`);
      }
    },
    [refs.mountedRef, refs.terminalRef],
  );
  const connection = useTerminalWebSocket({
    featureId: props.existingPtyId ? undefined : props.featureId,
    projectId: props.existingPtyId ? undefined : props.projectId,
    ptyId: props.existingPtyId,
    requestedCwd: props.requestedCwd,
    onData,
    onReady,
    onExit,
    onReconnected,
    onError,
  });
  refs.writeRef.current = connection.write;
  refs.resizeRef.current = connection.resize;
  refs.killRef.current = connection.kill;
  refs.connectRef.current = connection.connect;
}

interface TerminalRuntime {
  container: HTMLDivElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  opened: boolean;
  connected: boolean;
  dataDisposable: { dispose: () => void } | null;
  onFocusHandler: (() => void) | null;
  touchScrollCleanup: (() => void) | null;
}

function createTerminalRuntime(
  container: HTMLDivElement,
  props: XTermInstanceProps,
  refs: XTermRefs,
): TerminalRuntime {
  const terminal = createXtermInstance(props.theme);
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon(
    (event, uri) => {
      if (event.metaKey || event.ctrlKey) refs.linkRoutingRef.current?.activate(uri);
    },
    {
      hover: (_event, uri) => refs.linkRoutingRef.current?.setHoverLink(uri),
      leave: () => refs.linkRoutingRef.current?.setHoverLink(null),
    },
  );
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  attachXtermNavigationKeys(terminal, {
    exitedRef: refs.exitedRef,
    ptyIdRef: refs.ptyIdRef,
    writeRef: refs.writeRef,
  });
  refs.terminalRef.current = terminal;
  refs.fitAddonRef.current = fitAddon;
  return {
    connected: false,
    container,
    dataDisposable: null,
    fitAddon,
    onFocusHandler: null,
    opened: false,
    terminal,
    touchScrollCleanup: null,
  };
}

function ensureTerminalOpen(runtime: TerminalRuntime, refs: XTermRefs): boolean {
  if (runtime.opened) return true;
  if (runtime.container.offsetWidth === 0 || runtime.container.offsetHeight === 0) return false;
  runtime.terminal.open(runtime.container);
  runtime.onFocusHandler = (): void => refs.onTerminalFocusRef.current?.();
  runtime.terminal.textarea?.addEventListener("focus", runtime.onFocusHandler);
  runtime.dataDisposable = runtime.terminal.onData((data: string) => {
    if (!refs.ptyIdRef.current || refs.exitedRef.current) return;
    if (refs.ctrlArmedRef.current) {
      const control = toControlChar(data);
      refs.onConsumeCtrlRef.current?.();
      refs.writeRef.current?.(control ?? data);
      return;
    }
    refs.writeRef.current?.(data);
  });
  runtime.touchScrollCleanup = attachTouchScroll(runtime.container, runtime.terminal);
  runtime.opened = true;
  refs.openedRef.current = true;
  if (refs.pendingFocusRef.current) {
    refs.pendingFocusRef.current = false;
    runtime.terminal.focus();
  }
  return true;
}

function fitTerminal(runtime: TerminalRuntime, refs: XTermRefs): boolean {
  if (!refs.mountedRef.current || refs.exitedRef.current || !ensureTerminalOpen(runtime, refs)) {
    return false;
  }
  try {
    runtime.fitAddon.fit();
  } catch {
    return false;
  }
  if (!runtime.connected) {
    runtime.connected = true;
    refs.connectRef.current?.(runtime.terminal.cols, runtime.terminal.rows);
  } else if (refs.ptyIdRef.current) {
    refs.resizeRef.current?.(runtime.terminal.cols, runtime.terminal.rows);
  }
  return true;
}

function observeTerminalLayout(runtime: TerminalRuntime, refs: XTermRefs): () => void {
  const resizeObserver = new ResizeObserver((entries) => {
    if (!refs.mountedRef.current || refs.exitedRef.current) return;
    const entry = entries[0];
    if (entry && entry.contentRect.width === 0 && entry.contentRect.height === 0) return;
    if (runtime.connected && isResizing()) return;
    fitTerminal(runtime, refs);
  });
  resizeObserver.observe(runtime.container);
  const unsubscribeResize = subscribeResize((active) => {
    if (!active) fitTerminal(runtime, refs);
  });
  const intersectionObserver = new IntersectionObserver((entries) => {
    if (!refs.mountedRef.current || refs.exitedRef.current) return;
    if (entries[0]?.isIntersecting) fitTerminal(runtime, refs);
  });
  intersectionObserver.observe(runtime.container);
  let bootstrapFrame = 0;
  const tryBootstrap = (): void => {
    if (runtime.opened || !refs.mountedRef.current || refs.exitedRef.current) return;
    if (!fitTerminal(runtime, refs)) bootstrapFrame = requestAnimationFrame(tryBootstrap);
  };
  bootstrapFrame = requestAnimationFrame(tryBootstrap);
  return () => {
    cancelAnimationFrame(bootstrapFrame);
    intersectionObserver.disconnect();
    resizeObserver.disconnect();
    unsubscribeResize();
  };
}

function disposeTerminalRuntime(
  runtime: TerminalRuntime,
  refs: XTermRefs,
  stopObserving: () => void,
): void {
  refs.mountedRef.current = false;
  refs.linkRoutingRef.current?.setHoverLink(null);
  stopObserving();
  if (runtime.onFocusHandler) {
    runtime.terminal.textarea?.removeEventListener("focus", runtime.onFocusHandler);
  }
  runtime.touchScrollCleanup?.();
  runtime.dataDisposable?.dispose();
  if (refs.ptyIdRef.current && !refs.exitedRef.current && refs.shouldKillRef.current) {
    refs.killRef.current?.();
  }
  refs.ptyIdRef.current = null;
  refs.openedRef.current = false;
  refs.pendingFocusRef.current = false;
  runtime.terminal.dispose();
  refs.terminalRef.current = null;
  refs.fitAddonRef.current = null;
}

function useXTermMount(props: XTermInstanceProps, refs: XTermRefs) {
  useEffect(() => {
    refs.mountedRef.current = true;
    refs.exitedRef.current = false;
    const container = refs.containerRef.current;
    if (!container) return;
    const runtime = createTerminalRuntime(container, props, refs);
    const stopObserving = observeTerminalLayout(runtime, refs);
    return () => disposeTerminalRuntime(runtime, refs, stopObserving);
    // Palette changes are applied live below; remounting would lose scrollback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.featureId, props.projectId]);
  useEffect(() => {
    const terminal = refs.terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = { ...props.theme };
    if (terminal.element) terminal.refresh(0, terminal.rows - 1);
  }, [props.theme, refs.terminalRef]);
}

export function useXTermInstanceController(
  props: XTermInstanceProps,
  ref: ForwardedRef<XTermInstanceHandle>,
) {
  const refs = useXTermRefs(props);
  useXTermImperativeHandle(ref, {
    terminalRef: refs.terminalRef,
    openedRef: refs.openedRef,
    pendingFocusRef: refs.pendingFocusRef,
    shouldKillRef: refs.shouldKillRef,
    ptyIdRef: refs.ptyIdRef,
    exitedRef: refs.exitedRef,
    writeRef: refs.writeRef,
  });
  useXTermConnection(props, refs);
  useXTermMount(props, refs);
  return useMemo(() => ({ containerRef: refs.containerRef }), [refs.containerRef]);
}
