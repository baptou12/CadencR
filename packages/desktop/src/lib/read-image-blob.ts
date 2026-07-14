import { customInstance } from "@/api/client";

/**
 * Fetch raw image bytes for a project-relative path via the editor
 * `read-image` endpoint. Returned as a Blob so the API client's auth headers
 * travel with the request; callers turn it into a `blob:` object URL, which
 * the renderer CSP (`img-src 'self' data: blob:`) permits — unlike the API
 * origin, which it does not.
 */
export function readImageBlob(
  projectId: number,
  featureId: number,
  filePath: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return customInstance<Blob>({
    url: "/api/editor/read-image",
    method: "GET",
    params: { project_id: projectId, feature_id: featureId, file_path: filePath },
    responseType: "blob",
    signal,
  });
}

/** React Query key for a `read-image` fetch, so consumers share one cache entry. */
export function readImageBlobQueryKey(
  projectId: number,
  featureId: number,
  filePath: string,
): readonly unknown[] {
  return [
    "/api/editor/read-image",
    { project_id: projectId, feature_id: featureId, file_path: filePath },
  ];
}
