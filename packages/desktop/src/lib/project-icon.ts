import { customInstance } from "@/api/client";

/** Project setting key holding the chosen icon path. */
export const PROJECT_ICON_SETTING_KEY = "icon_path" as const;

/**
 * Fetch the bytes of a project's configured icon.
 *
 * Returned as a Blob so the API client's auth headers travel with the request
 * (the endpoint sits behind the same auth layer as everything else, so a bare
 * `<img src>` pointing at the API origin would fail on remote devices). Callers
 * turn it into a `blob:` object URL, which the renderer CSP permits — see
 * `read-image-blob.ts` for the same pattern.
 */
export function projectIconBlob(
  projectId: number,
  options: {
    /** Project-relative path to preview instead of the configured icon. */
    path?: string;
    signal?: AbortSignal;
  } = {},
): Promise<Blob> {
  return customInstance<Blob>({
    url: `/api/projects/${projectId}/icon`,
    method: "GET",
    params: options.path ? { path: options.path } : undefined,
    responseType: "blob",
    signal: options.signal,
  });
}

/**
 * React Query key for a project icon fetch.
 *
 * The stored path is part of the key on purpose: picking a different icon
 * changes the key, so the new image loads without anyone having to invalidate
 * the old entry. Icons are intentionally left out of the editor's file-watcher
 * invalidation wave — they render in several hot paths and effectively never
 * change mid-session.
 *
 * The head is deliberately NOT URL-shaped. A `/api/projects/...` key would be
 * picked up by the localStorage persister's safelist (`persistedQueries.ts`),
 * which would `JSON.stringify` the Blob into `{}` and rehydrate a truthy
 * non-Blob on next launch — `URL.createObjectURL({})` then throws in every
 * mounted badge. It also keeps the cache clear of any `invalidateByUrlPrefix`
 * walker aimed at `/api/projects`.
 */
export function projectIconQueryKey(projectId: number, iconPath: string): readonly unknown[] {
  return ["project-icon", { project_id: projectId, icon_path: iconPath }];
}
