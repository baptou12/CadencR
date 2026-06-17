import type { QueryClient } from "@tanstack/react-query";
import { urlPrefixPredicate } from "./queryClient";

// Workspace settings endpoints whose URL head is a stable prefix (no dynamic
// id). Matched via the shared orval-key prefix helper so the "how orval keys
// work" knowledge stays in one place.
const matchesWorkspaceSettingsUrl = urlPrefixPredicate([
  "/api/workspace/settings",
  "/api/workspace/model-settings",
  "/api/workspace/provider-settings",
]);

/**
 * Invalidate every query whose data derives from the settings JSON files —
 * not just the raw `settings` endpoints.
 *
 * Settings drive model selection, provider selection, and the agent catalog
 * (its default model/provider depend on the active Claude profile, which is a
 * setting). So a JSON edit — whether our own save or an external edit picked up
 * by the file watcher — must refresh those derived caches too, or the model
 * picker and provider toggles keep showing stale values.
 *
 * This deliberately spans two query-key shapes:
 *  - orval URL-string keys (`/api/.../settings`, `/api/.../model-settings`,
 *    `/api/.../provider-settings`), matched on the URL head; and
 *  - the hand-written custom keys in `api/agentRuntime.ts`
 *    (`["workspace"|"projects"|"features", "provider-settings", …]`,
 *    `["agent-catalog", …]`), matched structurally.
 *
 * Settings changes are rare and user-driven, so a slightly broad refetch here
 * is the right trade — correctness over shaving a few cache walks.
 */
export function invalidateSettingsDerivedQueries(client: QueryClient): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => {
      if (matchesWorkspaceSettingsUrl(query)) return true;

      const head = query.queryKey[0];
      const sub = query.queryKey[1];
      if (typeof head !== "string") return false;

      // Hand-written custom keys whose data depends on settings.
      if (head === "agent-catalog") return true;
      if (
        sub === "provider-settings" &&
        (head === "workspace" || head === "projects" || head === "features")
      ) {
        return true;
      }

      // Project/feature settings endpoints carry a dynamic id in the URL head,
      // so a plain prefix can't match — key off the id-agnostic path segment.
      return (
        (head.startsWith("/api/projects/") &&
          (head.includes("/settings") ||
            head.includes("/model-settings") ||
            head.includes("/provider-settings"))) ||
        (head.startsWith("/api/features/") &&
          (head.includes("/model-settings") || head.includes("/provider-settings")))
      );
    },
  });
}
