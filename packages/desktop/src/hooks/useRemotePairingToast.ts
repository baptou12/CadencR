import { useEffect } from "react";
import { toast } from "sonner";
import { takeJustPaired, takePairingError } from "@/api/remote-pairing";
import { trustCurrentDevice } from "@/lib/remote/device-token";

/**
 * One-shot pairing follow-ups for a remote-browser session (pairing runs before
 * React mounts, so its outcome is stashed and replayed here):
 *
 * - on failure, an error toast;
 * - on success, an offer to *stay signed in* — the "trust this device" decision
 *   lives on the device that paired, not in the host's link.
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
    if (takeJustPaired()) {
      toast.success("Connected to this workspace.", {
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
