import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { HAS_MAC_WINDOW_CONTROLS } from "@/lib/mac-window-controls";

// Toasts stack top-right under the workspace chrome (why: DESIGN.md "Toasts").
// The feature header matches the sidebar header (h-16, h-18 beside the macOS
// traffic lights); the pane tab strip sits under it.
const FEATURE_HEADER_HEIGHT = HAS_MAC_WINDOW_CONTROLS ? 72 : 64;
const PANE_TAB_STRIP_HEIGHT = 38;
const TOP_OFFSET = FEATURE_HEADER_HEIGHT + PANE_TAB_STRIP_HEIGHT + 8;

const TOAST_ICONS: ToasterProps["icons"] = {
  success: <CircleCheck />,
  error: <CircleAlert />,
  warning: <TriangleAlert />,
  info: <Info />,
  loading: <LoaderCircle className="animate-spin" />,
  close: <X />,
};

/**
 * Themed Sonner wrapper. Every variant shares the `--popover` surface; the
 * variant is carried by a tinted icon well (and a tinted rim for errors and
 * warnings). All chrome lives in `toast.css`. Per-call styling overrides at
 * the call site are forbidden — extend the styles there instead.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      closeButton
      gap={8}
      icons={TOAST_ICONS}
      offset={{ top: TOP_OFFSET, right: 16 }}
      // Below 600px Sonner spans the toasts full-width at the top. In an iOS
      // standalone PWA the UI runs under the status bar (black-translucent +
      // viewport-fit=cover), so pad by the safe-area inset (0 elsewhere).
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      style={
        {
          "--width": "380px",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
