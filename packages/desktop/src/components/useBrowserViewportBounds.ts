import { useCallback, useRef } from "react";

import { desktopBridge } from "@/lib/desktop-bridge";

interface ViewportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsFromElement(node: HTMLDivElement): ViewportBounds {
  const rect = node.getBoundingClientRect();
  return {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

function sameBounds(a: ViewportBounds | null, b: ViewportBounds): boolean {
  return a?.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

interface BoundsTrackerOptions {
  onBounds: (bounds: ViewportBounds) => void;
}

export interface BrowserViewportBoundsTracker {
  attach: (node: HTMLDivElement | null) => void;
  dispose: () => void;
}

export function createBrowserViewportBoundsTracker(
  options: BoundsTrackerOptions,
): BrowserViewportBoundsTracker {
  let nodeRef: HTMLDivElement | null = null;
  let observer: ResizeObserver | null = null;
  let frame: number | null = null;
  let lastBounds: ViewportBounds | null = null;

  const cancelFrame = (): void => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
  const disconnect = (): void => {
    observer?.disconnect();
    observer = null;
    cancelFrame();
  };
  const sync = (): void => {
    frame = null;
    const node = nodeRef;
    if (!node) return;
    const nextBounds = boundsFromElement(node);
    if (sameBounds(lastBounds, nextBounds)) return;
    lastBounds = nextBounds;
    options.onBounds(nextBounds);
  };
  const scheduleSync = (): void => {
    if (frame !== null) return;
    frame = requestAnimationFrame(sync);
  };
  const attach = (node: HTMLDivElement | null): void => {
    disconnect();
    nodeRef = node;
    lastBounds = null;
    if (!node) {
      options.onBounds({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleSync);
      observer.observe(node);
    }
    scheduleSync();
    node.ownerDocument.defaultView?.addEventListener("resize", scheduleSync);
    node.ownerDocument.defaultView?.addEventListener("scroll", scheduleSync, true);
  };
  const dispose = (): void => {
    const view = nodeRef?.ownerDocument.defaultView;
    view?.removeEventListener("resize", scheduleSync);
    view?.removeEventListener("scroll", scheduleSync, true);
    disconnect();
  };

  return { attach, dispose };
}

export function useBrowserViewportBounds(
  onError: (error: unknown) => void,
): (node: HTMLDivElement | null) => void {
  const trackerRef = useRef<BrowserViewportBoundsTracker | null>(null);

  return useCallback(
    (node: HTMLDivElement | null): void => {
      trackerRef.current?.dispose();
      trackerRef.current = createBrowserViewportBoundsTracker({
        onBounds: (bounds) => {
          void desktopBridge.setBrowserBounds(bounds).catch(onError);
        },
      });
      trackerRef.current.attach(node);
    },
    [onError],
  );
}
