import { useEffect, useState } from "react";
import { isMonospace } from "./isMonospace";

interface LocalFontData {
  family: string;
}
type QueryLocalFonts = () => Promise<LocalFontData[]>;

interface UseSystemFontsResult {
  fonts: string[];
  isLoading: boolean;
  error: boolean;
}

/**
 * Enumerate installed font families via the Local Font Access API. When
 * `showAll` is false, only families that pass the monospace heuristic are
 * kept. Any failure (API absent, permission denied, throw) yields an empty
 * list with `error: true` — the caller surfaces that to the user.
 */
export function useSystemFonts(showAll: boolean): UseSystemFontsResult {
  const [fonts, setFonts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;

    if (typeof query !== "function") {
      setError(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    query()
      .then((entries) => {
        if (cancelled) return;
        const families = Array.from(new Set(entries.map((e) => e.family)));
        const filtered = showAll ? families : families.filter(isMonospace);
        filtered.sort((a, b) => a.localeCompare(b));
        setFonts(filtered);
        setError(false);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFonts([]);
        setError(true);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showAll]);

  return { fonts, isLoading, error };
}
