import { useEffect, type ReactNode } from "react";
import { useMonoFont } from "@/lib/fonts/mono-font-setting";

/**
 * Reads the resolved monospace font stack and mirrors it onto the
 * `--font-mono` CSS variable on <html>. CodeMirror, Markdown code snippets,
 * and the Pierre git diff all read `--font-mono`, so they re-skin for free.
 * The xterm terminal is canvas-rendered and can't read CSS — it has its own
 * bridge (see XTermInstance / TerminalPanel).
 *
 * Mount once near the root, beside AnimationsProvider.
 */
export function MonoFontProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { resolved } = useMonoFont();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--font-mono", resolved);
  }, [resolved]);

  return <>{children}</>;
}
