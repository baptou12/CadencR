import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  parseSystemAppearance,
  readBrowserSystemAppearance,
  SYSTEM_DARK_MEDIA_QUERY,
  type ThemeAppearance,
} from "@/lib/themes";

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

    let windowHandle: ReturnType<typeof getCurrentWindow> | null = null;
    try {
      windowHandle = getCurrentWindow();
    } catch (err: unknown) {
      setError(err instanceof Error ? err : new Error(String(err)));
      const unsubscribe = subscribeToBrowserAppearance(() => cancelled, setAppearance);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    let browserUnlisten: (() => void) | null = null;

    if (typeof windowHandle.theme === "function") {
      windowHandle
        .theme()
        .then((theme) => {
          if (cancelled) return;
          if (theme) setAppearance(parseSystemAppearance(theme));
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err : new Error(String(err)));
          setAppearance(readBrowserSystemAppearance());
        });
    } else {
      browserUnlisten = subscribeToBrowserAppearance(() => cancelled, setAppearance);
    }

    if (typeof windowHandle.onThemeChanged === "function") {
      windowHandle
        .onThemeChanged(({ payload }) => {
          setError(null);
          setAppearance(parseSystemAppearance(payload));
        })
        .then((nextUnlisten) => {
          if (cancelled) {
            nextUnlisten();
            return;
          }
          unlisten = nextUnlisten;
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
        });
    } else if (!browserUnlisten) {
      browserUnlisten = subscribeToBrowserAppearance(() => cancelled, setAppearance);
    }

    return () => {
      cancelled = true;
      unlisten?.();
      browserUnlisten?.();
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
