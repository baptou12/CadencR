import { useEffect, useState } from "react";

/**
 * Expose a Blob as an object URL, revoking the previous URL whenever the blob
 * changes and on unmount so nothing leaks. Returns `null` until a blob is
 * available.
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}
