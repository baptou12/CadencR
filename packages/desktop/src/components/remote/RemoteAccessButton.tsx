import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { Loader2, Radio } from "lucide-react";
import { isBrowserRemote } from "@/lib/remote/device-token";
import { useRemoteStore } from "@/stores/remote-store";
import { SIDEBAR_FOOTER_PILL_CLASS } from "@/lib/changelog";
import { cn } from "@/lib/utils";

// The dialog (and its QR dependency) only loads when the user opens the panel.
const RemoteAccessDialog = lazy(() =>
  import("./RemoteAccessDialog").then((m) => ({ default: m.RemoteAccessDialog })),
);

/**
 * Sidebar-footer affordance for remote access, modeled on `SidebarUpdateButton`.
 * Shows a prominent green dot when remote access is on. Managing remote access
 * is host-only, so the button is hidden inside a remote browser session.
 */
export function RemoteAccessButton(): ReactElement | null {
  const enabled = useRemoteStore((s) => s.status?.enabled ?? false);
  const loaded = useRemoteStore((s) => s.loaded);
  const refresh = useRemoteStore((s) => s.refresh);
  const [open, setOpen] = useState(false);

  // Fetch status once so the "ON" dot is accurate before the dialog is opened.
  // Guarded to the host shell — the control endpoints are loopback-only.
  useEffect(() => {
    if (!isBrowserRemote() && !loaded) void refresh();
  }, [loaded, refresh]);

  if (isBrowserRemote()) return null;

  return (
    <>
      <button
        type="button"
        data-nav-item
        onClick={() => setOpen(true)}
        className={cn(SIDEBAR_FOOTER_PILL_CLASS, "text-foreground/80")}
        title={enabled ? "Remote access is ON" : "Remote access"}
      >
        <span className="flex items-center gap-2">
          <Radio className="size-4 shrink-0" aria-hidden />
          <span>Remote access</span>
        </span>
        {enabled ? (
          <span aria-hidden title="ON" className="size-1.5 rounded-full bg-[var(--acc-green)]" />
        ) : null}
      </button>

      {open ? (
        <Suspense
          fallback={
            // Brief dialog-chunk load: a dimmed backdrop + spinner so the open
            // click has immediate, modal-shaped feedback instead of a dead frame.
            <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
              <Loader2 className="size-5 animate-spin text-white" aria-hidden />
            </div>
          }
        >
          <RemoteAccessDialog onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}
