import { useEffect, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * Live-swap the xterm font when the user changes the mono font. Cell metrics
 * depend on the face, so refit before forcing a redraw. Twin of the theme
 * live-swap effect in XTermInstance.
 */
export function useXtermFontSync(
  terminalRef: RefObject<Terminal | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  fontFamily: string | undefined,
): void {
  useEffect(() => {
    const term = terminalRef.current;
    if (!term || !fontFamily) return;
    term.options.fontFamily = fontFamily;
    fitAddonRef.current?.fit();
    if (term.element) term.refresh(0, term.rows - 1);
  }, [terminalRef, fitAddonRef, fontFamily]);
}
