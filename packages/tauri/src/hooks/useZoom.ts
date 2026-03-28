import { useCallback, useEffect, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useDebouncedSetting } from "./useDebouncedSetting";

const ZOOM_KEY = "zoom_global";
const ZOOM_DEFAULT = 100;
const ZOOM_MIN = 50;
const ZOOM_MAX = 200;
const ZOOM_STEP = 10;

function clampZoom(level: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, level));
}

function applyZoom(level: number) {
  if (!isTauri()) return;
  void getCurrentWebview().setZoom(level / 100);
}

/**
 * Returns zoom state and actions. Call `useZoomHotkeys` separately in the
 * single root component that should own the keyboard shortcuts.
 */
export function useZoom() {
  const setting = useDebouncedSetting(ZOOM_KEY, 0);
  const currentRef = useRef(ZOOM_DEFAULT);

  const persisted = setting.value ? Number(setting.value) : ZOOM_DEFAULT;
  currentRef.current = persisted;

  useEffect(() => {
    applyZoom(persisted);
  }, [persisted]);

  const setZoom = useCallback(
    (level: number) => {
      const clamped = clampZoom(level);
      applyZoom(clamped);
      currentRef.current = clamped;
      setting.setValue(String(clamped));
    },
    [setting],
  );

  const zoomIn = useCallback(() => {
    setZoom(currentRef.current + ZOOM_STEP);
  }, [setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(currentRef.current - ZOOM_STEP);
  }, [setZoom]);

  const resetZoom = useCallback(() => {
    setZoom(ZOOM_DEFAULT);
  }, [setZoom]);

  return { zoomLevel: persisted, zoomIn, zoomOut, resetZoom, setZoom };
}

/** Registers Cmd+=/Cmd+-/Cmd+0 hotkeys. Call only once (root layout). */
export function useZoomHotkeys() {
  const { zoomIn, zoomOut, resetZoom } = useZoom();

  const hotkeyOpts = { enableOnFormTags: true, enableOnContentEditable: true } as const;
  useHotkeys("meta+equal", (e) => { e.preventDefault(); zoomIn(); }, hotkeyOpts);
  useHotkeys("meta+minus", (e) => { e.preventDefault(); zoomOut(); }, hotkeyOpts);
  useHotkeys("meta+0", (e) => { e.preventDefault(); resetZoom(); }, hotkeyOpts);
}
