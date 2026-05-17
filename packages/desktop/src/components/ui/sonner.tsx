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
