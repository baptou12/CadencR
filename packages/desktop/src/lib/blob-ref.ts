import { customInstance } from "@/api/client";

/**
 * Scheme marking a payload the backend moved out of `agent_messages.content`
 * and into the on-disk blob store. Must stay in sync with `BLOB_REF_SCHEME` in
 * `packages/service/src/domain/blobs/extract.rs`.
 */
export const BLOB_REF_SCHEME = "cadencr-blob://";

/** Lowercase hex SHA-256 — the shape the backend's `is_valid_hash` accepts. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The blob hash inside a reference, or `null` when `value` is anything else
 * (inline base64, a data URL, prose). Validates the hash shape so a malformed
 * reference degrades to "not a blob" rather than producing a request that can
 * only 404.
 */
export function parseBlobRef(value: string | undefined): string | null {
  if (!value?.startsWith(BLOB_REF_SCHEME)) return null;
  const hash = value.slice(BLOB_REF_SCHEME.length);
  return HASH_PATTERN.test(hash) ? hash : null;
}

/**
 * Fetch a blob's bytes.
 *
 * Returned as a Blob so the API client's auth headers travel with the request
 * and callers can build a `blob:` object URL — the renderer CSP is
 * `img-src 'self' data: blob:`, so pointing an `<img>` at the API origin is
 * silently blocked. Same shape as `read-image-blob.ts` for the same reason.
 */
export function fetchBlob(hash: string, signal?: AbortSignal): Promise<Blob> {
  return customInstance<Blob>({
    url: `/api/blobs/${hash}`,
    method: "GET",
    responseType: "blob",
    signal,
  });
}

/** Query key for a blob fetch, so every consumer of one hash shares a cache entry. */
export function blobQueryKey(hash: string): readonly unknown[] {
  return ["/api/blobs", hash];
}
