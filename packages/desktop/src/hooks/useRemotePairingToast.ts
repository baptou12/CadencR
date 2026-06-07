import { useEffect } from "react";
import { toast } from "sonner";
import { takeJustPaired, takePairingError } from "@/api/remote-pairing";
import { trustCurrentDevice } from "@/lib/remote/device-token";

/**
 * One-shot pairing follow-ups for a remote-browser session (pairing runs before
 * React mounts — or before the gate's reload — so its outcome is stashed and
 * replayed here):
 *
 * - on failure, an error toast;
 * - after a session-only pair (the Safari `?code=` flow), an offer to *stay
 *   signed in* — the "trust this device" decision lives on the device that
 *   paired, not in the host's link;
 * - after a trusted pair (the manual gate, e.g. an installed PWA, which already
 *   persisted to `localStorage`), a plain confirmation — without this, the PWA
 *   path showed no post-pair feedback at all.
 *
 * No-op in the desktop shell or when there's nothing to replay.
 */
export function useRemotePairingToast(): void {
  useEffect(() => {
    const error = takePairingError();
    if (error) {
      toast.error(error);
      return;
    }
    const mode = takeJustPaired();
    if (mode === "trusted") {
      toast.success("Connected to this workspace.", {
        description: "This device will stay signed in.",
      });
    } else if (mode === "session") {
      toast.success("Connected to this workspace.", {
        // Actionable and easy to miss on mobile, so give it well beyond the
        // default dismiss window to read the question and tap "Stay signed in".
        duration: 15000,
        description: "Stay signed in on this device after closing the tab?",
        action: {
          label: "Stay signed in",
          onClick: () => {
            if (trustCurrentDevice()) toast.success("This device will stay signed in.");
            else toast.error("Couldn't save sign-in on this device.");
          },
        },
      });
    }
  }, []);
}
