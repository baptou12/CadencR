import { useImperativeHandle, type ForwardedRef, type MutableRefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import type { XTermInstanceHandle } from "./XTermInstance.types";

interface XTermHandleRefs {
  terminalRef: MutableRefObject<Terminal | null>;
  openedRef: MutableRefObject<boolean>;
  pendingFocusRef: MutableRefObject<boolean>;
  shouldKillRef: MutableRefObject<boolean>;
  ptyIdRef: MutableRefObject<string | null>;
  exitedRef: MutableRefObject<boolean>;
  writeRef: MutableRefObject<((data: string) => void) | null>;
}

export function useXTermImperativeHandle(
  ref: ForwardedRef<XTermInstanceHandle>,
  refs: XTermHandleRefs,
): void {
  useImperativeHandle(ref, () => ({
    focus: () => focusTerminal(refs),
    clearScreen: () => refs.writeRef.current?.("\x0c"),
    clearInput: () => refs.writeRef.current?.("\x05\x15"),
    blur: () => blurTerminal(refs),
    markForKill: () => {
      refs.shouldKillRef.current = true;
    },
    write: (data: string) => {
      if (refs.ptyIdRef.current && !refs.exitedRef.current) refs.writeRef.current?.(data);
    },
  }));
}

function focusTerminal(refs: XTermHandleRefs): void {
  const terminal = refs.terminalRef.current;
  if (!terminal) return;
  terminal.options.cursorBlink = true;
  if (!refs.openedRef.current) {
    refs.pendingFocusRef.current = true;
    return;
  }
  terminal.focus();
}

function blurTerminal(refs: XTermHandleRefs): void {
  const terminal = refs.terminalRef.current;
  if (!terminal) return;
  terminal.options.cursorBlink = false;
  refs.pendingFocusRef.current = false;
  terminal.blur();
}
