import { useEffect, useRef } from "react";
import { useIsFetching, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const TOAST_ID = "global-ops";

/** Maps React Query keys to friendly, non-technical labels */
const OPERATION_LABELS: Record<string, string> = {};

/** Excluded prefixes — high-frequency polling/streaming queries that shouldn't show toasts */
const EXCLUDED_PREFIXES = ["agents.", "sessions.", "features."];

/** Converts a query key like "diffComments.getByFeature" into "Loading diff comments" */
function humanizeKey(key: string): string {
  // Take the router name (first segment), split camelCase, and title-case it
  const router = key.split(".")[0];
  const words = router.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `Loading ${words}`;
}

function extractOperationKey(queryKey: readonly unknown[]): string | null {
  // React Query keys are arrays like [["git", "getStats"], { input: ... }]
  const first = queryKey[0];
  if (Array.isArray(first) && first.length >= 2 && typeof first[0] === "string") {
    const key = first.join(".");
    if (EXCLUDED_PREFIXES.some((p) => key.startsWith(p))) return null;
    return key;
  }
  return null;
}

export function useOperationToasts() {
  const queryClient = useQueryClient();
  const fetchCount = useIsFetching();
  const mutateCount = useIsMutating();
  const prevActiveRef = useRef(false);

  useEffect(() => {
    const totalActive = fetchCount + mutateCount;

    if (totalActive === 0) {
      if (prevActiveRef.current) {
        toast.dismiss(TOAST_ID);
      }
      prevActiveRef.current = false;
      return;
    }

    // Gather active operation names from query cache
    const activeOps: string[] = [];

    const queries = queryClient.getQueryCache().findAll({ fetchStatus: "fetching" });
    for (const query of queries) {
      const key = extractOperationKey(query.queryKey);
      if (key) {
        activeOps.push(OPERATION_LABELS[key] ?? humanizeKey(key));
      }
    }

    const mutations = queryClient.getMutationCache().findAll({ fetching: true });
    for (const mutation of mutations) {
      const key = extractOperationKey(mutation.options.mutationKey ?? []);
      if (key) {
        activeOps.push(OPERATION_LABELS[key] ?? humanizeKey(key));
      }
    }

    // Deduplicate
    const unique = [...new Set(activeOps)];
    if (unique.length === 0) {
      // Active requests exist but all are excluded — don't show toast
      if (prevActiveRef.current) {
        toast.dismiss(TOAST_ID);
        prevActiveRef.current = false;
      }
      return;
    }

    const display = unique.slice(0, 5);
    const extra = unique.length - display.length;
    const lines = [...display];
    if (extra > 0) lines.push(`and ${extra} more...`);

    toast.loading(
      <div className="flex flex-col gap-0.5">
        {lines.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </div>,
      { id: TOAST_ID },
    );
    prevActiveRef.current = true;
  }, [fetchCount, mutateCount, queryClient]);
}
