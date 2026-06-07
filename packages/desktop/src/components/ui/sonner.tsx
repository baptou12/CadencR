import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Themed Sonner wrapper. Every variant shares the same `--popover` surface
 * so the toast chrome stays consistent across themes; the variant identity
 * is carried by the icon color and a thin left accent strip. The strip and
 * icon styles live in `theme.css` (search `data-sonner-toast`). Per-call
 * styling overrides at the call site are forbidden — extend the styles
 * there instead.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      // In an iOS standalone PWA the UI runs under the status bar (black-translucent
      // + viewport-fit=cover), so a top-center toast would sit behind the notch.
      // Pad the top offset by the safe-area inset; it resolves to 0 on desktop, so
      // loopback/desktop toasts are unchanged. Mirrors AppShell's safe-area padding.
      offset={{ top: "calc(env(safe-area-inset-top) + 16px)" }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      toastOptions={{
        style: {
          padding: "10px 12px",
          fontSize: "13px",
          gap: "8px",
        },
      }}
      style={
        {
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
