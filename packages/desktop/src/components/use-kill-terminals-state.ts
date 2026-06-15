import { useCallback, useEffect, useMemo, useState } from "react";
import { useListFeatureActivity, type Feature } from "@/api/generated";

export interface KillTerminalsState {
  liveTerminalCount: number;
  killTerminals: boolean;
  toggleKillTerminals: () => void;
}

/**
 * Tracks a feature's running shells while a remove dialog is open and exposes a
 * "kill terminals" toggle (defaulting off, reset whenever the dialog closes or
 * every shell goes idle).
 *
 * Reads the same `list_feature_activity` source the sidebar uses so the count
 * always matches the activity indicator instead of stale PTY handles that linger
 * after a shell exits. That count (`shell_count`) reflects the feature's active
 * terminals plus any running background tasks, so it can exceed the number of
 * shells actually killed — the kill response reports the real total. Sharing the
 * sidebar's exact query key reuses its cached/polled data rather than issuing a
 * second request.
 */
export function useKillTerminalsState(
  open: boolean,
  feature: Feature | undefined,
): KillTerminalsState {
  const [killTerminals, setKillTerminals] = useState(false);
  const activity = useListFeatureActivity(
    { project_id: feature?.project_id ?? 0, include_archived: true },
    { query: { enabled: open && feature != null, refetchInterval: 2000 } },
  );
  const liveTerminalCount = useMemo(() => {
    if (!feature) return 0;
    return activity.data?.find((item) => item.feature_id === feature.id)?.shell_count ?? 0;
  }, [activity.data, feature]);

  // Reset on close, and drop the selection if every shell goes idle while open.
  useEffect(() => {
    if (!open || liveTerminalCount === 0) setKillTerminals(false);
  }, [open, liveTerminalCount]);

  const toggleKillTerminals = useCallback((): void => {
    if (liveTerminalCount === 0) return;
    setKillTerminals((value) => !value);
  }, [liveTerminalCount]);

  return useMemo(
    () => ({ liveTerminalCount, killTerminals, toggleKillTerminals }),
    [liveTerminalCount, killTerminals, toggleKillTerminals],
  );
}
