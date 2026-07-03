import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Drives a "go fullscreen" affordance via the standard Fullscreen API.
 *
 * `supported` is false on iOS Safari/Chrome (WebKit on iPhone exposes no
 * Fullscreen API) — callers should hide the control there and rely on
 * "Add to Home Screen" standalone mode instead. Where it IS supported
 * (Android Chrome, desktop browsers), `toggle()` enters/exits fullscreen on
 * the document element so the mobile browser's URL/toolbar chrome collapses.
 */
export interface FullscreenControls {
  supported: boolean;
  isFullscreen: boolean;
  /** Already running chromeless (iOS "Add to Home Screen" / installed PWA). */
  isStandalone: boolean;
  toggle: () => void;
}

interface IosNavigator extends Navigator {
  standalone?: boolean;
}

export function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as IosNavigator).standalone === true
  );
}

function subscribe(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
}

function getSnapshot(): boolean {
  return document.fullscreenElement != null;
}

export function useFullscreen(): FullscreenControls {
  const isFullscreen = useSyncExternalStore(subscribe, getSnapshot, () => false);
  const supported =
    typeof document !== "undefined" &&
    document.fullscreenEnabled === true &&
    typeof document.documentElement.requestFullscreen === "function";

  const toggle = useCallback((): void => {
    if (!supported) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch((err: unknown) => {
        console.warn("[fullscreen] exit failed", err);
      });
    } else {
      void document.documentElement.requestFullscreen().catch((err: unknown) => {
        console.warn("[fullscreen] request failed", err);
      });
    }
  }, [supported]);

  const isStandalone = detectStandalone();
  return useMemo<FullscreenControls>(
    () => ({ supported, isFullscreen, isStandalone, toggle }),
    [supported, isFullscreen, isStandalone, toggle],
  );
}
