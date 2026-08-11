import { useEffect, useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { blobQueryKey, fetchBlob } from "@/lib/blob-ref";

/**
 * Resolve blob hashes to `blob:` object URLs.
 *
 * Payloads the backend off-loaded out of message content arrive as
 * `cadencr-blob://<hash>` references, and the renderer CSP (`img-src 'self'
 * data: blob:`) means the bytes have to be fetched and wrapped in an object URL
 * rather than linked directly. Blobs are content-addressed and therefore
 * immutable, so they are cached indefinitely and never refetched.
 *
 * Returns a hash → URL map plus the set of hashes whose fetch failed. The two
 * are kept apart because "still loading" and "these bytes are gone" look
 * identical otherwise, and a payload the blob store can no longer produce has to
 * say so rather than sit on a placeholder forever.
 */
export interface BlobUrls {
  urls: ReadonlyMap<string, string>;
  failed: ReadonlySet<string>;
}

/** Release raw image bytes after the last observer has been gone for a while. */
const BLOB_CACHE_GC_MS = 5 * 60 * 1000;

export function useBlobUrls(hashes: readonly string[]): BlobUrls {
  // De-duplicate so one screenshot repeated in a message is fetched once, and
  // keep a stable identity so the query list doesn't churn every render.
  const unique = useMemo(() => Array.from(new Set(hashes)), [hashes.join("\u0000")]);

  const results = useQueries({
    queries: unique.map((hash) => ({
      queryKey: blobQueryKey(hash),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchBlob(hash, signal),
      staleTime: Infinity,
      // The object URL is revoked when this leaf unmounts; do not retain the
      // underlying multi-megabyte Blob forever in the global QueryClient too.
      gcTime: BLOB_CACHE_GC_MS,
      retry: false,
    })),
  });

  const blobs = useMemo(() => {
    const found = new Map<string, Blob>();
    unique.forEach((hash, index) => {
      const blob = results[index]?.data;
      if (blob instanceof Blob) found.set(hash, blob);
    });
    return found;
  }, [unique, results.map((result) => (result.data ? "1" : "0")).join("")]);

  const failed = useMemo(() => {
    const missing = new Set<string>();
    unique.forEach((hash, index) => {
      if (results[index]?.isError) missing.add(hash);
    });
    return missing;
  }, [unique, results.map((result) => (result.isError ? "1" : "0")).join("")]);

  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const objectUrls = useRef(new Map<string, { blob: Blob; url: string }>());

  useEffect(() => {
    let changed = false;
    for (const [hash, entry] of objectUrls.current) {
      if (blobs.has(hash)) continue;
      URL.revokeObjectURL(entry.url);
      objectUrls.current.delete(hash);
      changed = true;
    }
    for (const [hash, blob] of blobs) {
      const existing = objectUrls.current.get(hash);
      if (existing?.blob === blob) continue;
      if (existing) URL.revokeObjectURL(existing.url);
      objectUrls.current.set(hash, { blob, url: URL.createObjectURL(blob) });
      changed = true;
    }
    if (changed) {
      setUrls(new Map(Array.from(objectUrls.current, ([hash, entry]) => [hash, entry.url])));
    }
  }, [blobs]);

  useEffect(() => {
    return () => {
      for (const entry of objectUrls.current.values()) URL.revokeObjectURL(entry.url);
      objectUrls.current.clear();
    };
  }, []);

  return useMemo(() => ({ urls, failed }), [urls, failed]);
}
