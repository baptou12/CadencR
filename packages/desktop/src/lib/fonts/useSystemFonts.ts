import { useCallback, useRef, useState } from "react";
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
 */
export function useSystemFonts(): UseSystemFontsResult {
  const [fonts, setFonts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  const load = useCallback((showAll: boolean) => {
    const id = ++requestId.current;
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
        const filtered = showAll ? families : families.filter(isMonospace);
        filtered.sort((a, b) => a.localeCompare(b));
        setFonts(filtered);
        setError(false);
        setIsLoading(false);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setFonts([]);
        setError(true);
        setIsLoading(false);
      });
  }, []);

  return { fonts, isLoading, error, load };
}
