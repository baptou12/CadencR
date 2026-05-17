import { useEffect } from "react";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useUpdateStore } from "@/stores/update-store";

/**
 * Wire the main process's auto-updater events into the renderer-side update
 * store. Mount once from the root layout.
 *
 * UI surfacing (a sidebar button + dialog) lives in `SidebarUpdateButton` —
 * we deliberately do NOT show a toast here, since updates are persistent
 * state that belongs in a discoverable, non-ephemeral affordance.
 */
export function useAutoUpdateBridge(): void {
  useEffect(() => {
    const applyEvent = useUpdateStore.getState().applyEvent;
    return desktopBridge.onUpdateEvent(applyEvent);
  }, []);
}
