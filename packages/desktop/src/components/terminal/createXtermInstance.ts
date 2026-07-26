import { Terminal } from "@xterm/xterm";
import type { XTermPalette } from "@/lib/themes";
import { DEFAULT_MONO_STACK } from "@/lib/fonts/constants";

export function createXtermInstance(
  theme: XTermPalette,
  fontFamily: string = DEFAULT_MONO_STACK,
): Terminal {
  return new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    cursorWidth: 2,
    fontSize: 13,
    lineHeight: 1.2,
    fontFamily,
    fontWeight: "400",
    fontWeightBold: "600",
    letterSpacing: 0,
    theme,
    // Honor translucent theme backgrounds (the Frost themes paint a transparent
    // xterm background so the frosted terminal panel + ambient gradient show
    // through). Harmless for opaque themes — their hex backgrounds have full
    // alpha, so nothing changes visually.
    allowTransparency: true,
    macOptionIsMeta: true,
    allowProposedApi: true,
    scrollback: 5000,
  });
}
