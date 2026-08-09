import { useCallback, useMemo, useRef, useState } from "react";
import { isMonospace } from "./isMonospace";

interface LocalFontData {
  family: unknown;
}

declare global {
  interface Window {
    /** Local Font Access API — not yet in TS's lib.dom.d.ts. */
    queryLocalFonts?: (this: Window) => Promise<LocalFontData[]>;
  }
}

interface UseSystemFontsResult {
  fonts: string[];
  isLoading: boolean;
  error: boolean;
  load: (showAll: boolean) => void;
}

function isValidEntries(entries: unknown): entries is LocalFontData[] {
  return (
    Array.isArray(entries) &&
    entries.every(
      (e) => typeof e === "object" && e !== null && typeof (e as LocalFontData).family === "string",
    )
  );
}

/**
 * Enumerate installed font families via the Local Font Access API. When
 * `showAll` is false, only families that pass the monospace heuristic are
 * kept. Any failure (API absent, permission denied, malformed response,
 * throw) yields an empty list with `error: true` — the caller surfaces that
 * to the user.
 *
 * `queryLocalFonts()` requires transient user activation: call `load()`
 * synchronously from a user-gesture handler (click, toggle), never on mount.
 *
 * Both the enumeration and the per-family monospace heuristic (which measures
 * glyphs on a canvas) are cached for the lifetime of the hook, so toggling
 * `showAll` re-derives the visible list without re-querying or re-measuring.
 */
export function useSystemFonts(): UseSystemFontsResult {
  const [fonts, setFonts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const familiesRef = useRef<string[] | null>(null);
  const monospaceRef = useRef(new Map<string, boolean>());

  const applyFamilies = useCallback((families: string[], showAll: boolean) => {
    const cache = monospaceRef.current;
    const visible = showAll
      ? [...families]
      : families.filter((family) => {
          const cached = cache.get(family);
          if (cached !== undefined) return cached;
          const measured = isMonospace(family);
          cache.set(family, measured);
          return measured;
        });
    visible.sort((a, b) => a.localeCompare(b));
    setFonts(visible);
    setError(false);
    setIsLoading(false);
  }, []);

  const load = useCallback(
    (showAll: boolean) => {
      const id = ++requestId.current;

      const cachedFamilies = familiesRef.current;
      if (cachedFamilies) {
        applyFamilies(cachedFamilies, showAll);
        return;
      }

      const query = window.queryLocalFonts;

      if (typeof query !== "function") {
        setError(true);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      let pending: Promise<unknown>;
      try {
        // Call on `window` directly: extracting the method first loses the
        // receiver the WebIDL binding expects and can throw synchronously.
        pending = query.call(window);
      } catch {
        setFonts([]);
        setError(true);
        setIsLoading(false);
        return;
      }

      pending
        .then((entries) => {
          if (id !== requestId.current) return;
          if (!isValidEntries(entries)) {
            setFonts([]);
            setError(true);
            setIsLoading(false);
            return;
          }
          const families = Array.from(new Set(entries.map((e) => e.family as string)));
          familiesRef.current = families;
          applyFamilies(families, showAll);
        })
        .catch(() => {
          if (id !== requestId.current) return;
          setFonts([]);
          setError(true);
          setIsLoading(false);
        });
    },
    [applyFamilies],
  );

  return useMemo(() => ({ fonts, isLoading, error, load }), [fonts, isLoading, error, load]);
}
