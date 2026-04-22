import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import type { MouseEvent } from "react";

const INTERACTIVE = "button, a, input, select, textarea, [role='button']";
let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
function getWindow() {
  if (!appWindow) appWindow = getCurrentWindow();
  return appWindow;
}

function isInteractive(e: MouseEvent): boolean {
  return e.button !== 0 || !!(e.target as HTMLElement).closest(INTERACTIVE);
}

/** Attach as `onMouseDown` to make an element a window drag region. */
export function startDragging(e: MouseEvent) {
  if (isInteractive(e)) return;
  e.preventDefault();
  getWindow()
    .startDragging()
    .catch(() => toast.error("Failed to drag window"));
}

/** Attach as `onDoubleClick` to toggle maximize on double-click. */
export function toggleMaximize(e: MouseEvent) {
  if (isInteractive(e)) return;
  e.preventDefault();
  getWindow()
    .toggleMaximize()
    .catch(() => toast.error("Failed to toggle maximize"));
}
