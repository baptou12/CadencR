import { useEffect, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useRemoteStore } from "@/stores/remote-store";
import { RemoteLanSection } from "./RemoteLanSection";
import { RemotePairSection } from "./RemotePairSection";
import { RemoteTunnelSection } from "./RemoteTunnelSection";
import { RemoteDevicesSection } from "./RemoteDevicesSection";
import { RemoteActivitySection } from "./RemoteActivitySection";

/**
 * Host control surface for remote access. Opens from the sidebar button; on
 * open it fetches current status. The on/off toggle, pairing, device list, and
 * audit tail all live here. Loopback-only — never rendered in a remote browser.
 */
export function RemoteAccessDialog({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const status = useRemoteStore((s) => s.status);
  const loaded = useRemoteStore((s) => s.loaded);
  const phase = useRemoteStore((s) => s.phase);
  const error = useRemoteStore((s) => s.error);
  const refresh = useRemoteStore((s) => s.refresh);
  const enable = useRemoteStore((s) => s.enable);
  const disable = useRemoteStore((s) => s.disable);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabled = status?.enabled ?? false;
  const busy = phase !== "idle";
  // First fetch still in flight: show a loader rather than a misleading "off".
  const initialLoading = !loaded && phase === "loading";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Remote access</DialogTitle>
          <DialogDescription>
            Use this workspace from another device over your network. Anyone who can reach your
            machine and pair gains full access — only enable it on networks you trust.
          </DialogDescription>
        </DialogHeader>

        {initialLoading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Checking remote access…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <div className="text-sm font-medium">Remote access is {enabled ? "on" : "off"}</div>
                <div className="text-xs text-muted-foreground">
                  {enabled
                    ? "Reachable over TLS on your local network."
                    : "Turn on to expose the workspace over your local network."}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {phase === "mutating" ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                ) : null}
                <Switch
                  checked={enabled}
                  disabled={busy}
                  onCheckedChange={(next) => void (next ? enable() : disable())}
                  aria-label="Toggle remote access"
                />
              </div>
            </div>

            {error ? <p className="text-xs text-[var(--acc-red)]">{error}</p> : null}

            {enabled && status ? (
              <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
                <RemoteLanSection status={status} />
                <RemotePairSection />
                <RemoteTunnelSection status={status} />
                <RemoteDevicesSection status={status} />
                <RemoteActivitySection status={status} />
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
