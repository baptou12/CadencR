import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";
import { isResizing, subscribeResize } from "@/lib/resize-coordinator";
import type { XTermPalette } from "@/lib/themes";

interface XTermInstanceProps {
  featureId: number;
  projectId: number;
  /** Existing PTY ID to reconnect to (from zustand store) */
  existingPtyId?: string;
  /** Working directory hint forwarded to the backend on a fresh PTY request. */
  requestedCwd?: string;
  /** Active theme's xterm palette — applied at mount and live-swapped when
   *  the user picks a new theme. Canvas-rendered xterm can't read CSS vars,
   *  so this has to flow through props. */
  theme: XTermPalette;
  /** Called when the PTY process exits (e.g. Ctrl+D) */
  onExit?: (ptyId: string) => void;
  /**
   * Called after a PTY is created or reconnected — parent stores the ptyId
   * and (when known) the working directory the PTY was spawned in. `cwd` is
   * null on reconnect when the backend handle has been garbage-collected.
   */
  onPtyReady?: (ptyId: string, cwd: string | null) => void;
  /** If true, kill the PTY when unmounting (explicit close). Default: false (detach only). */
  killOnUnmount?: boolean;
  /** Command to write to the PTY after creation (does NOT press Enter — command includes \n if needed) */
  initialCommand?: string;
  /** Called after the initial command has been written so the parent can clear it from state */
  onInitialCommandConsumed?: () => void;
  /** Called when the terminal receives focus */
  onTerminalFocus?: () => void;
}

export interface XTermInstanceHandle {
  /** Focus this terminal instance */
  focus: () => void;
  /** Blur this terminal instance and stop cursor blink */
  blur: () => void;
  /** Mark this instance for PTY kill on next unmount */
  markForKill: () => void;
}

export const XTermInstance = forwardRef<XTermInstanceHandle, XTermInstanceProps>(
  function XTermInstance(
    {
      featureId,
      projectId,
      existingPtyId,
      requestedCwd,
      theme,
      onExit,
      onPtyReady,
      killOnUnmount = false,
      initialCommand,
      onInitialCommandConsumed,
      onTerminalFocus,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const ptyIdRef = useRef<string | null>(existingPtyId ?? null);
    const mountedRef = useRef(true);
    const exitedRef = useRef(false);
    const shouldKillRef = useRef(killOnUnmount);
    // True once `terminal.open(container)` has actually run — only after that
    // point does `term.focus()` reach a real textarea. Focus requests that
    // arrive before then (e.g. CMD+T or post-split focus, where the new pane
    // mounts and we ask it to focus on the same frame) are remembered in
    // `pendingFocusRef` and replayed at the end of `ensureOpen()`.
    const openedRef = useRef(false);
    const pendingFocusRef = useRef(false);

    shouldKillRef.current = killOnUnmount;
    const onTerminalFocusRef = useRef(onTerminalFocus);
    onTerminalFocusRef.current = onTerminalFocus;
    const initialCommandRef = useRef(initialCommand);
    initialCommandRef.current = initialCommand;
    const onInitialCommandConsumedRef = useRef(onInitialCommandConsumed);
    onInitialCommandConsumedRef.current = onInitialCommandConsumed;

    useImperativeHandle(ref, () => ({
      focus: () => {
        const term = terminalRef.current;
        if (!term) return;
        term.options.cursorBlink = true;
        if (!openedRef.current) {
          // xterm isn't opened yet — there's no textarea to focus. Remember
          // the request and replay it from `ensureOpen()` once `terminal.open`
          // has run. Without this, post-create focus calls (CMD+T, post-split)
          // silently no-op because the dimensions race wins.
          pendingFocusRef.current = true;
          return;
        }
        term.focus();
      },
      blur: () => {
        const term = terminalRef.current;
        if (!term) return;
        term.options.cursorBlink = false;
        // Clear any pending focus so a blur after a deferred focus actually
        // sticks instead of being overridden when the terminal finally opens.
        pendingFocusRef.current = false;
        term.blur();
      },
      markForKill: () => {
        shouldKillRef.current = true;
      },
    }));

    // Stable refs for ws actions so callbacks don't need to re-subscribe
    const writeRef = useRef<((data: string) => void) | null>(null);
    const resizeRef = useRef<((cols: number, rows: number) => void) | null>(null);
    const killRef = useRef<(() => void) | null>(null);
    const connectRef = useRef<((cols: number, rows: number) => void) | null>(null);

    // -- WebSocket callbacks (stable refs to avoid re-connecting) --

    const onWsData = useCallback((data: string) => {
      if (mountedRef.current) terminalRef.current?.write(data);
    }, []);

    const onWsReady = useCallback(
      (ptyId: string, cwd: string) => {
        if (!mountedRef.current) {
          // Unmounted before ready — kill via ws
          killRef.current?.();
          return;
        }
        ptyIdRef.current = ptyId;
        onPtyReady?.(ptyId, cwd);
        // Write initial command if provided
        const cmd = initialCommandRef.current;
        if (cmd) {
          setTimeout(() => {
            if (mountedRef.current && ptyIdRef.current) {
              writeRef.current?.(cmd);
            }
            onInitialCommandConsumedRef.current?.();
          }, 150);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const onWsExit = useCallback(
      (code: number) => {
        if (!mountedRef.current) return;
        exitedRef.current = true;
        const id = ptyIdRef.current;
        terminalRef.current?.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
        if (id) onExit?.(id);
      },
      [onExit],
    );

    const onWsReconnected = useCallback(
      (scrollback: string, alive: boolean, cwd: string | null) => {
        if (!mountedRef.current) return;
        if (!alive) {
          exitedRef.current = true;
          terminalRef.current?.write("\r\n\x1b[90m[Terminal session ended]\x1b[0m\r\n");
          const id = ptyIdRef.current;
          if (id) onExit?.(id);
          return;
        }
        const id = ptyIdRef.current;
        if (id) onPtyReady?.(id, cwd);
        // Visible "we recovered" marker before re-applying scrollback so the
        // user sees that the prior "Connection lost. Reconnecting…" line
        // produced a successful reattach rather than a silent comeback.
        terminalRef.current?.write("\r\n\x1b[32m[Terminal reconnected]\x1b[0m\r\n");
        if (scrollback) terminalRef.current?.write(scrollback);
        // Sync size after reconnect
        try {
          fitAddonRef.current?.fit();
          const term = terminalRef.current;
          if (term) resizeRef.current?.(term.cols, term.rows);
        } catch {
          // Ignore resize errors
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      },
      [onExit],
    );

    const onWsError = useCallback((message: string) => {
      if (!mountedRef.current) return;
      terminalRef.current?.write(`\r\n\x1b[31m[${message}]\x1b[0m\r\n`);
    }, []);

    const { connect, write, resize, kill } = useTerminalWebSocket({
      featureId: existingPtyId ? undefined : featureId,
      projectId: existingPtyId ? undefined : projectId,
      ptyId: existingPtyId,
      requestedCwd,
      onData: onWsData,
      onReady: onWsReady,
      onExit: onWsExit,
      onReconnected: onWsReconnected,
      onError: onWsError,
    });

    writeRef.current = write;
    resizeRef.current = resize;
    killRef.current = kill;
    connectRef.current = connect;

    useEffect(() => {
      mountedRef.current = true;
      exitedRef.current = false;
      const container = containerRef.current;
      if (!container) return;

      // The mount effect intentionally doesn't depend on `theme` (re-mounting
      // would lose scrollback). Subsequent palette changes flow through the
      // live-swap effect below, which mutates `terminal.options.theme`.
      const terminal = createXtermInstance(theme);
      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);

      // macOS-style navigation: Cmd+Arrow (line) and Option+Arrow (word).
      // Safe to attach pre-`open()` — handler only fires once a textarea exists.
      //
      // The modifier check must be *exclusive*: CMD+OPT+Arrow is the split-
      // navigation chord owned by TerminalPanel, not a line/word jump. If we
      // only checked `metaKey ? "meta" : altKey ? "alt"`, the meta branch
      // would win on CMD+OPT+ArrowLeft and we'd ship \x01 (Ctrl+A) to the
      // pane the user is *leaving*, which the user reported as "arrows do
      // nothing visible to the splits".
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (!ptyIdRef.current || exitedRef.current) return true;
        const keyMap: Record<string, string> = {
          "meta+ArrowLeft": "\x01",
          "meta+ArrowRight": "\x05",
          "alt+ArrowLeft": "\x1bb",
          "alt+ArrowRight": "\x1bf",
        };
        const isOnlyMeta = event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
        const isOnlyAlt = event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
        const mod = isOnlyMeta ? "meta" : isOnlyAlt ? "alt" : "";
        const seq = mod ? keyMap[`${mod}+${event.key}`] : undefined;
        if (seq) {
          writeRef.current?.(seq);
          return false;
        }
        return true;
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // We defer `terminal.open(container)` until the container actually has
      // pixel dimensions. xterm.js opened in a `display:none` parent
      // initializes its renderer in a degraded 0×0 state and never recovers
      // cleanly even after `fit()` — the textarea ends up unfocusable and
      // the screen stays blank. With the new layout system, tab content is
      // always mounted (even when its tab isn't the active one in its
      // pane), so the container starts hidden whenever the user opens a
      // session in another tab. The single ResizeObserver below is the one
      // signal we need: when it sees a non-zero rect we can open xterm,
      // wire up data + focus listeners, run a fit, and connect the WS — in
      // that order.
      let opened = false;
      let connected = false;
      let dataDisposable: { dispose: () => void } | null = null;
      let onFocusHandler: (() => void) | null = null;

      const ensureOpen = (): boolean => {
        if (opened) return true;
        if (container.offsetWidth === 0 || container.offsetHeight === 0) return false;
        terminal.open(container);
        onFocusHandler = (): void => onTerminalFocusRef.current?.();
        terminal.textarea?.addEventListener("focus", onFocusHandler);
        dataDisposable = terminal.onData((data: string) => {
          if (ptyIdRef.current && !exitedRef.current) {
            writeRef.current?.(data);
          }
        });
        opened = true;
        openedRef.current = true;
        // Replay any focus request that came in before the textarea existed.
        // This is what makes CMD+T / post-split focus actually land on the
        // freshly-mounted pane.
        if (pendingFocusRef.current) {
          pendingFocusRef.current = false;
          terminal.focus();
        }
        return true;
      };

      const runFit = (): boolean => {
        if (!mountedRef.current || exitedRef.current) return false;
        if (!ensureOpen()) return false;
        try {
          fitAddon.fit();
        } catch {
          return false;
        }
        if (!connected) {
          connected = true;
          connectRef.current?.(terminal.cols, terminal.rows);
        } else {
          const id = ptyIdRef.current;
          if (id) resizeRef.current?.(terminal.cols, terminal.rows);
        }
        return true;
      };

      const resizeObserver = new ResizeObserver((entries) => {
        if (!mountedRef.current || exitedRef.current) return;
        // Skip when container is hidden (display:none) — fitting with 0 dimensions
        // causes xterm.js to reflow the buffer and drop lines irreversibly.
        const entry = entries[0];
        if (entry && entry.contentRect.width === 0 && entry.contentRect.height === 0) return;
        // Defer fit while the user is actively dragging a resize handle.
        // `fitAddon.fit()` measures the cell metrics off the DOM and reflows
        // xterm's buffer; running it per frame for every visible terminal pane
        // during a drag is one of the dominant cascading-RO costs we want to
        // avoid. We catch up with a single `fit()` once the drag ends. The
        // very first fit (pre-`connected`) must still run so the PTY can
        // boot at correct dimensions.
        if (connected && isResizing()) return;
        runFit();
      });
      resizeObserver.observe(container);

      // Catch-up fit on resize-end so the terminal lands at the final size.
      const unsubscribeResize = subscribeResize((active) => {
        if (active) return;
        runFit();
      });

      // Visibility signal. `ResizeObserver` is known to silently skip
      // `display:none` → `display:block` transitions in some Chromium
      // versions (crbug.com/899068) — the user clicks the Terminal tab,
      // we flip our tab-mount's display, but no RO callback ever fires,
      // so xterm never gets opened. `IntersectionObserver` is the right
      // tool here: it fires reliably the moment the element enters the
      // viewport, including when an ancestor flips from display:none.
      const intersectionObserver = new IntersectionObserver((entries) => {
        if (!mountedRef.current || exitedRef.current) return;
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        runFit();
      });
      intersectionObserver.observe(container);

      // Belt-and-braces rAF retry: covers any layout edge case that
      // neither RO nor IO catch (e.g. container parented but still 0×0
      // because a flex parent hasn't laid out yet). Stops the moment
      // xterm opens successfully.
      let bootstrapRaf = 0;
      const tryBootstrap = (): void => {
        if (opened || !mountedRef.current || exitedRef.current) return;
        if (runFit()) return;
        bootstrapRaf = requestAnimationFrame(tryBootstrap);
      };
      bootstrapRaf = requestAnimationFrame(tryBootstrap);

      return () => {
        mountedRef.current = false;
        cancelAnimationFrame(bootstrapRaf);
        intersectionObserver.disconnect();
        resizeObserver.disconnect();
        unsubscribeResize();
        if (onFocusHandler) terminal.textarea?.removeEventListener("focus", onFocusHandler);
        dataDisposable?.dispose();

        if (ptyIdRef.current && !exitedRef.current && shouldKillRef.current) {
          killRef.current?.();
        }
        ptyIdRef.current = null;
        openedRef.current = false;
        pendingFocusRef.current = false;
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [featureId, projectId]);

    // Live-swap the xterm palette on theme change. xterm short-circuits when
    // the same reference is reassigned, so we spread into a fresh literal,
    // then `refresh()` forces an immediate canvas redraw. The renderer can
    // only refresh once xterm has been opened against a sized container —
    // before that, options.theme is enough; the open() pass picks it up.
    useEffect(() => {
      const term = terminalRef.current;
      if (!term) return;
      term.options.theme = { ...theme };
      if (term.element) term.refresh(0, term.rows - 1);
    }, [theme]);

    return (
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{
          backgroundColor: "var(--terminal-bg)",
          paddingLeft: 8,
          paddingRight: 8,
        }}
      />
    );
  },
);

function createXtermInstance(theme: XTermPalette): Terminal {
  return new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    cursorWidth: 2,
    fontSize: 13,
    lineHeight: 1.2,
    fontFamily:
      "'FiraCode Nerd Font', 'Fira Code', 'CaskaydiaCove Nerd Font', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    theme,
    macOptionIsMeta: true,
    allowProposedApi: true,
    scrollback: 5000,
  });
}
