import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import type { MouseEvent } from "react";

const INTERACTIVE = "button, a, input, select, textarea, [role='button']";

const RADIX_OVERLAY_ROLES =
  "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='tooltip']";

let appWindow: ReturnType<typeof getCurrentWindow> | null = null;
function getWindow() {
  if (!appWindow) appWindow = getCurrentWindow();
  return appWindow;
}

function isInteractive(e: MouseEvent): boolean {
  if (e.button !== 0) return true;
  const target = e.target as HTMLElement;
  if (target.closest(INTERACTIVE)) return true;
  if (target.closest(RADIX_OVERLAY_ROLES)) return true;
  if (e.shiftKey || e.altKey) return true;
  const selection = window.getSelection();
  if (selection && selection.toString().length > 0) return true;
  return false;
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
