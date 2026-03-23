import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTerminalWebSocket } from "@/hooks/useTerminalWebSocket";

interface XTermInstanceProps {
  featureId: number;
  projectId: number;
  /** Existing PTY ID to reconnect to (from zustand store) */
  existingPtyId?: string;
  /** Called when the PTY process exits (e.g. Ctrl+D) */
  onExit?: (ptyId: string) => void;
  /** Called after a PTY is created or reconnected — parent stores the ptyId */
  onPtyReady?: (ptyId: string) => void;
  /** If true, kill the PTY when unmounting (explicit close). Default: false (detach only). */
  killOnUnmount?: boolean;
  /** Command to write to the PTY after creation (does NOT press Enter — command includes \n if needed) */
  initialCommand?: string;
  /** Called after the initial command has been written so the parent can clear it from state */
  onInitialCommandConsumed?: () => void;
}

export interface XTermInstanceHandle {
  /** Focus this terminal instance */
  focus: () => void;
  /** Mark this instance for PTY kill on next unmount */
  markForKill: () => void;
}

export const XTermInstance = forwardRef<XTermInstanceHandle, XTermInstanceProps>(
  function XTermInstance(
    {
      featureId,
      projectId,
      existingPtyId,
      onExit,
      onPtyReady,
      killOnUnmount = false,
      initialCommand,
      onInitialCommandConsumed,
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

    shouldKillRef.current = killOnUnmount;
    const initialCommandRef = useRef(initialCommand);
    initialCommandRef.current = initialCommand;
    const onInitialCommandConsumedRef = useRef(onInitialCommandConsumed);
    onInitialCommandConsumedRef.current = onInitialCommandConsumed;

    useImperativeHandle(ref, () => ({
      focus: () => terminalRef.current?.focus(),
      markForKill: () => {
        shouldKillRef.current = true;
      },
    }));

    // -- WebSocket callbacks (stable refs to avoid re-connecting) --

    const onWsData = useCallback((data: string) => {
      if (mountedRef.current) terminalRef.current?.write(data);
    }, []);

    const onWsReady = useCallback(
      (ptyId: string) => {
        if (!mountedRef.current) {
          // Unmounted before ready — kill via ws
          wsRef.current.kill();
          return;
        }
        ptyIdRef.current = ptyId;
        onPtyReady?.(ptyId);
        syncSize();
        // Write initial command if provided
        const cmd = initialCommandRef.current;
        if (cmd) {
          setTimeout(() => {
            if (mountedRef.current && ptyIdRef.current) {
              wsRef.current.write(cmd);
            }
            onInitialCommandConsumedRef.current?.();
          }, 150);
        }
        terminalRef.current?.focus();
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    const onWsExit = useCallback(
      (code: number) => {
        if (!mountedRef.current) return;
        exitedRef.current = true;
        const id = ptyIdRef.current;
        terminalRef.current?.write(
          `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`,
        );
        if (id) onExit?.(id);
      },
      [onExit],
    );

    const onWsReconnected = useCallback((scrollback: string, alive: boolean) => {
      if (!mountedRef.current) return;
      if (!alive) {
        exitedRef.current = true;
        terminalRef.current?.write("\r\n\x1b[90m[Terminal session ended]\x1b[0m\r\n");
        const id = ptyIdRef.current;
        if (id) onExit?.(id);
        return;
      }
      if (scrollback) terminalRef.current?.write(scrollback);
      syncSize();
      terminalRef.current?.focus();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onExit]);

    const onWsError = useCallback((message: string) => {
      if (!mountedRef.current) return;
      terminalRef.current?.write(`\r\n\x1b[31m[${message}]\x1b[0m\r\n`);
    }, []);

    const wsRef = useRef<ReturnType<typeof useTerminalWebSocket>>(null!);

    const ws = wsRef.current = useTerminalWebSocket({
      featureId: existingPtyId ? undefined : featureId,
      projectId: existingPtyId ? undefined : projectId,
      ptyId: existingPtyId,
      onData: onWsData,
      onReady: onWsReady,
      onExit: onWsExit,
      onReconnected: onWsReconnected,
      onError: onWsError,
    });

    // Helper to sync terminal size to backend
    function syncSize() {
      try {
        fitAddonRef.current?.fit();
        const term = terminalRef.current;
        if (term) wsRef.current.resize(term.cols, term.rows);
      } catch {
        // Ignore resize errors during teardown
      }
    }

    useEffect(() => {
      mountedRef.current = true;
      exitedRef.current = false;
      const container = containerRef.current;
      if (!container) return;

      const terminal = createXtermInstance();
      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.open(container);

      // macOS-style navigation: Cmd+Arrow (line) and Option+Arrow (word)
      terminal.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (!ptyIdRef.current || exitedRef.current) return true;
        const keyMap: Record<string, string> = {
          "meta+ArrowLeft": "\x01",
          "meta+ArrowRight": "\x05",
          "alt+ArrowLeft": "\x1bb",
          "alt+ArrowRight": "\x1bf",
        };
        const mod = event.metaKey ? "meta" : event.altKey ? "alt" : "";
        const seq = mod ? keyMap[`${mod}+${event.key}`] : undefined;
        if (seq) {
          wsRef.current.write(seq);
          return false;
        }
        return true;
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      try {
        fitAddon.fit();
      } catch {
        // Container might not be sized yet
      }

      // User input → WebSocket
      const dataDisposable = terminal.onData((data: string) => {
        if (ptyIdRef.current && !exitedRef.current) {
          wsRef.current.write(data);
        }
      });

      // ResizeObserver for auto-fitting
      const resizeObserver = new ResizeObserver(() => {
        if (!mountedRef.current || exitedRef.current) return;
        try {
          fitAddon.fit();
          const id = ptyIdRef.current;
          if (id) wsRef.current.resize(terminal.cols, terminal.rows);
        } catch {
          // Ignore resize errors during teardown
        }
      });
      resizeObserver.observe(container);

      return () => {
        mountedRef.current = false;
        resizeObserver.disconnect();
        dataDisposable.dispose();

        if (ptyIdRef.current && !exitedRef.current && shouldKillRef.current) {
          wsRef.current.kill();
        }
        ptyIdRef.current = null;
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [featureId, projectId, existingPtyId]);

    return (
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ backgroundColor: "#1a1b26" }}
      />
    );
  },
);

/** Create a configured xterm.js Terminal instance */
function createXtermInstance(): Terminal {
  return new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    fontSize: 13,
    lineHeight: 1.2,
    fontFamily:
      "'Fira Code', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    theme: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#c0caf5",
      cursorAccent: "#1a1b26",
      selectionBackground: "#33467c",
      selectionForeground: "#c0caf5",
      selectionInactiveBackground: "#283457",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
    macOptionIsMeta: true,
    allowProposedApi: true,
    scrollback: 5000,
  });
}
