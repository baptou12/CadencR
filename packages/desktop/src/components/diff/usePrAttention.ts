import { useEffect, useMemo, useRef, useState } from "react";
import type { PrStatusSnapshot } from "@/api/generated";

/**
 * Marks the PR/MR tab when its provider-visible state changes while the user
 * is elsewhere. `pr.updated_at` is the cross-forge signal for new discussion
 * activity; the CI projection catches check transitions that do not update the
 * proposal itself. Opening the PR view acknowledges the latest signal.
 */
export function usePrAttention(status: PrStatusSnapshot | undefined, active: boolean): boolean {
  const signal = useMemo(() => prAttentionSignal(status), [status]);
  const acknowledged = useRef<string | null | undefined>(undefined);
  const [attention, setAttention] = useState(false);

  useEffect(() => {
    if (active) {
      acknowledged.current = signal;
      setAttention(false);
      return;
    }
    if (acknowledged.current === undefined) {
      acknowledged.current = signal;
      return;
    }
    if (signal !== acknowledged.current) setAttention(true);
  }, [active, signal]);

  return attention;
}

export function prAttentionSignal(status: PrStatusSnapshot | undefined): string | null {
  if (!status) return null;
  return JSON.stringify({
    proposal: status.pr
      ? {
          number: status.pr.number,
          updatedAt: status.pr.updated_at,
          state: status.pr.state,
          reviewState: status.pr.review_state,
        }
      : null,
    ci: status.ci
      ? {
          state: status.ci.state,
          checks: status.ci.checks.map((check) => [check.name, check.state, check.url]),
        }
      : null,
    error: status.error ?? null,
    authRequired: status.auth_required,
  });
}
