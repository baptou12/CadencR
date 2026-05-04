import { useEffect } from "react";
import { createEnvelope } from "@/lib/ws-envelope";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { selectGitWatcherEpoch, useGitStatusStore } from "@/stores/useGitStatusStore";

/**
 * Subscribes the active app-level WebSocket to per-feature `git.status`
 * envelopes. Mirrors `useFileWatcher`: one connection serves the whole app,
 * we just send `app/subscribe.git_status` / `unsubscribe.git_status`
 * envelopes carrying the feature_id. The backend's `GitWatcherRegistry`
 * starts a `notify` watcher on first subscription and tears it down after
 * the last unsubscribe.
 *
 * The first event the backend pushes after subscribing is the initial
 * snapshot, which `ws-git-status-handler` writes into `useGitStatusStore`.
 *
 * **Re-subscribes on worktree transitions.** The backend resolves the
 * watcher's path *at subscribe time* (`worktree_path` setting → project path
 * fallback). If we mount before the worktree exists, the initial subscription
 * binds to the project path — and keeps emitting snapshots from there even
 * after `worktree_path` is written. The WS envelope handler bumps a per-
 * feature `watcherEpoch` whenever it sees `workflow/worktree.created` or
 * `workflow/worktree.ready`; including the epoch in the effect deps tears
 * down the old subscription and starts a new one, forcing the backend to
 * re-resolve and bind to the freshly-created worktree. This works for both
 * the workflow view and ws-session — the epoch is driven by the WS
 * envelope (single source of truth) rather than by either store's local
 * worktreeStatus field.
 */
export function useGitStatusSubscription(featureId: number | null | undefined): void {
  // Only re-run when the connection state, feature_id, or watcher epoch
  // flips. Reading `ws` directly would force a re-subscribe on every store
  // mutation; narrow selectors keep the subscription stable otherwise.
  const ws = useSessionStatusStore((s) => s.ws);
  const isConnected = useSessionStatusStore((s) => s.isConnected);
  const watcherEpoch = useGitStatusStore(selectGitWatcherEpoch(featureId));

  useEffect(() => {
    if (featureId == null) return;
    if (!ws || !isConnected || ws.readyState !== WebSocket.OPEN) return;

    ws.send(
      JSON.stringify(createEnvelope("app", "subscribe.git_status", { feature_id: featureId })),
    );

    return () => {
      // Use the WS captured at effect-setup time — the cleanup runs on
      // unmount/feature change, the store may already point at a fresh
      // socket, but we want to drop the subscription on the *old* one.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify(
            createEnvelope("app", "unsubscribe.git_status", { feature_id: featureId }),
          ),
        );
      }
    };
    // `watcherEpoch` is in the deps on purpose — see the docblock above.
  }, [ws, isConnected, featureId, watcherEpoch]);
}
