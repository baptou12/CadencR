import { useEffect, useMemo, useState } from "react";
import {
  parseSystemAppearance,
  readBrowserSystemAppearance,
  SYSTEM_DARK_MEDIA_QUERY,
  type ThemeAppearance,
} from "@/lib/themes";
import { desktopBridge } from "@/lib/desktop-bridge";

interface UseSystemAppearanceResult {
  appearance: ThemeAppearance;
  error: Error | null;
}

export function useSystemAppearance(): UseSystemAppearanceResult {
  const [appearance, setAppearance] = useState<ThemeAppearance>(() =>
    readBrowserSystemAppearance(),
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const browserUnlisten = subscribeToBrowserAppearance(() => cancelled, setAppearance);

    desktopBridge
      .currentTheme()
      .then((theme) => {
        if (cancelled) return;
        setAppearance(parseSystemAppearance(theme));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setAppearance(readBrowserSystemAppearance());
      });

    try {
      unlisten = desktopBridge.onThemeChange((theme) => {
        setError(null);
        setAppearance(parseSystemAppearance(theme));
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }

    return () => {
      cancelled = true;
      unlisten?.();
      browserUnlisten();
    };
  }, []);

  return useMemo(() => ({ appearance, error }), [appearance, error]);
}

function subscribeToBrowserAppearance(
  isCancelled: () => boolean,
  setAppearance: (appearance: ThemeAppearance) => void,
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const query = window.matchMedia(SYSTEM_DARK_MEDIA_QUERY);
  setAppearance(query.matches ? "dark" : "light");

  const onChange = (event: MediaQueryListEvent): void => {
    if (!isCancelled()) setAppearance(event.matches ? "dark" : "light");
  };
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
