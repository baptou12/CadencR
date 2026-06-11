import type { BrowserBounds } from "./browser-types";
import type { BrowserWindow } from "electron";

export interface BrowserWindowOffset {
  x: number;
  y: number;
}

/**
 * Convert renderer viewport bounds (CSS px, in the main window's zoomed coordinate
 * space) into window DIP. `getBoundingClientRect` is scaled by the page zoom factor,
 * but `WebContentsView.setBounds` expects unzoomed window points — without this the
 * native view is mis-sized and shifted toward the origin whenever UI zoom ≠ 100%.
 */
export function scaleBounds(bounds: BrowserBounds, zoomFactor: number): BrowserBounds {
  const factor = zoomFactor > 0 ? zoomFactor : 1;
  return {
    x: bounds.x * factor,
    y: bounds.y * factor,
    width: bounds.width * factor,
    height: bounds.height * factor,
  };
}

export function sanitizeBounds(bounds: BrowserBounds): BrowserBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
}

export function windowRelativeBounds(
  bounds: BrowserBounds,
  offset: BrowserWindowOffset,
): BrowserBounds {
  const clean = sanitizeBounds(bounds);
  return {
    ...clean,
    x: clean.x + Math.max(0, Math.round(offset.x)),
    y: clean.y + Math.max(0, Math.round(offset.y)),
  };
}

export function contentOffset(win: BrowserWindow | null): BrowserWindowOffset {
  if (!win) return { x: 0, y: 0 };
  const frame = win.getBounds();
  const content = win.getContentBounds();
  return { x: content.x - frame.x, y: content.y - frame.y };
}

export function hiddenBounds(): BrowserBounds {
  return { x: -10000, y: -10000, width: 1, height: 1 };
}

export function browserBounds(bounds: BrowserBounds, devtoolsOpen: boolean): BrowserBounds {
  return devtoolsOpen
    ? { ...bounds, height: Math.max(1, Math.floor(bounds.height * 0.62)) }
    : bounds;
}

export function devtoolsBounds(bounds: BrowserBounds): BrowserBounds {
  const top = Math.floor(bounds.height * 0.62);
  return {
    x: bounds.x,
    y: bounds.y + top,
    width: bounds.width,
    height: Math.max(1, bounds.height - top),
  };
}
