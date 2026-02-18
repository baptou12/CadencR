import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { trpc } from "@/trpc";

interface XTermInstanceProps {
  featureId: number;
  projectId: number;
  /** Called when the PTY process exits (e.g. Ctrl+D) */
  onExit?: (ptyId: string) => void;
}

export interface XTermInstanceHandle {
  /** Focus this terminal instance */
  focus: () => void;
}

export const XTermInstance = forwardRef<XTermInstanceHandle, XTermInstanceProps>(function XTermInstance({ featureId, projectId, onExit }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const exitedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focus: () => {
      terminalRef.current?.focus();
    },
  }));

  const createMutation = trpc.terminal.create.useMutation();
  const writeMutation = trpc.terminal.write.useMutation();
  const resizeMutation = trpc.terminal.resize.useMutation();
  const killMutation = trpc.terminal.kill.useMutation();

  useEffect(() => {
    mountedRef.current = true;
    exitedRef.current = false;
    const container = containerRef.current;
    if (!container) return;

    // Create xterm.js Terminal instance
    // Tokyo Night theme — consistent with the app's dark theme (#1a1b26 background)
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', Menlo, Monaco, 'Courier New', monospace",
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
      allowProposedApi: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Initial fit
    try {
      fitAddon.fit();
    } catch {
      // Container might not be sized yet
    }

    // Listen for terminal data input → write to PTY
    const dataDisposable = terminal.onData((data: string) => {
      const id = ptyIdRef.current;
      if (id && !exitedRef.current) {
        writeMutation.mutate({ ptyId: id, data });
      }
    });

    // Listen for terminal:data IPC events → write to xterm
    const dataListener = window.api.onTerminalData((event: { ptyId: string; data: string }) => {
      if (event.ptyId === ptyIdRef.current && mountedRef.current) {
        terminal.write(event.data);
      }
    });

    // Listen for terminal:exit IPC events
    const exitListener = window.api.onTerminalExit((event: { ptyId: string; exitCode: number; signal?: number }) => {
      if (event.ptyId === ptyIdRef.current && mountedRef.current) {
        exitedRef.current = true;
        terminal.write(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
        onExit?.(event.ptyId);
      }
    });

    // ResizeObserver for auto-fitting
    const resizeObserver = new ResizeObserver(() => {
      if (mountedRef.current && !exitedRef.current) {
        try {
          fitAddon.fit();
          const id = ptyIdRef.current;
          if (id) {
            resizeMutation.mutate({
              ptyId: id,
              cols: terminal.cols,
              rows: terminal.rows,
            });
          }
        } catch {
          // Ignore resize errors during teardown
        }
      }
    });
    resizeObserver.observe(container);

    // Create the PTY
    createMutation.mutate(
      { featureId, projectId },
      {
        onSuccess: (result) => {
          if (!mountedRef.current) {
            // Component unmounted before PTY was created — kill it immediately
            killMutation.mutate({ ptyId: result.ptyId });
            return;
          }
          ptyIdRef.current = result.ptyId;
          // Sync initial size
          try {
            fitAddon.fit();
            resizeMutation.mutate({
              ptyId: result.ptyId,
              cols: terminal.cols,
              rows: terminal.rows,
            });
          } catch {
            // Ignore
          }
          terminal.focus();
        },
        onError: (err) => {
          if (mountedRef.current) {
            terminal.write(`\r\n\x1b[31m[Failed to create terminal: ${err.message}]\x1b[0m\r\n`);
          }
        },
      },
    );

    // Cleanup
    return () => {
      mountedRef.current = false;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      window.api.offTerminalData(dataListener);
      window.api.offTerminalExit(exitListener);

      const id = ptyIdRef.current;
      if (id && !exitedRef.current) {
        killMutation.mutate({ ptyId: id });
      }
      ptyIdRef.current = null;

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId, projectId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ backgroundColor: "#1a1b26" }}
    />
  );
});
