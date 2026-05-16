import { useEffect } from "react";
import { toast } from "sonner";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useUpdateStore } from "@/stores/update-store";

/**
 * Wire the main process's auto-updater events into the renderer-side update
 * store, and surface a toast when an update is ready to install. Mount once
 * from the root layout.
 */
export function useAutoUpdateBridge(): void {
  useEffect(() => {
    const applyEvent = useUpdateStore.getState().applyEvent;
    const unsubscribe = desktopBridge.onUpdateEvent((event) => {
      applyEvent(event);
      if (event.kind === "downloaded") {
        toast.success(`Update v${event.version} ready`, {
          description: "Restart Cadencr to install.",
          duration: Infinity,
          action: {
            label: "Restart now",
            onClick: () => {
              void useUpdateStore.getState().installUpdate();
            },
          },
        });
      } else if (event.kind === "error") {
        // Errors are surfaced inline in the About section; avoid noisy toasts
        // for background checks. Intentionally no-op here.
      }
    });
    return unsubscribe;
  }, []);
}
