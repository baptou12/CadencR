/**
 * Smart split-button surfaced in `FeatureTopBar`. The primary slot shows the
 * next sensible Git action (commit → push → PR) derived from the live
 * `GitStatusSnapshot`; the caret slot opens a popover listing all three with
 * tooltips that explain why each action is unavailable.
 *
 * Performance:
 * - Subscribes via narrow selectors so streaming updates from other features
 *   don't trigger re-renders here.
 * - `React.memo` plus a `useMemo` derivation hook keep the renders bound to
 *   actual snapshot changes.
 * - `CommitDialog` is loaded lazily so its file-list query and Radix Dialog
 *   subtree only mount when the dialog opens.
 */
import { lazy, memo, Suspense, useCallback, useState, type ReactElement } from "react";
import { ChevronDown, GitCommit } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { selectGitStatus, useGitStatusStore } from "@/stores/useGitStatusStore";
import { getCompareUrl } from "@/api/generated";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { useGlobalShortcutById, useShortcut } from "@/hooks/useShortcut";
import { isInCodeMirrorEditor } from "@/lib/shortcuts/dom-targets";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useGitAction, type GitAction } from "./useGitAction";
import { GitActionPopover, ICONS } from "./GitActionPopover";

const GIT_ACTION_BUTTON_CLASS =
  "border-border/80 bg-muted/20 text-xs text-foreground hover:bg-muted/35 disabled:opacity-100 disabled:bg-muted/20 disabled:text-muted-foreground";

const CommitDialog = lazy(() => import("./CommitDialog"));
const PushDialog = lazy(() => import("./PushDialog"));
const MergeDialog = lazy(() => import("./MergeDialog"));

interface GitActionButtonProps {
  featureId: number;
}

async function openExternal(url: string): Promise<void> {
  try {
    await desktopBridge.openExternal(url);
  } catch (error) {
    toast.error("Couldn't open compare URL.", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

export const GitActionButton = memo(function GitActionButton({
  featureId,
}: GitActionButtonProps): ReactElement | null {
  const snapshot = useGitStatusStore(selectGitStatus(featureId));
  const state = useGitAction(snapshot);
  const [commitOpen, setCommitOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  // The push flow now lives in `PushDialog`: ssh prompts (passphrase,
  // first-time host key) need a real UI surface, and even on the happy
  // path the live `git push` output is useful transparency. Opening the
  // dialog auto-starts the push — the user already clicked once to get
  // here, a second confirmation would be friction.
  const openPush = useCallback(() => setPushOpen(true), []);

  const runOpenCompare = useCallback(async () => {
    // Prefer the URL the backend already computed and shipped in the snapshot.
    let url = snapshot?.compare_url ?? null;
    if (!url) {
      try {
        const res = await getCompareUrl({ feature_id: featureId });
        if (res.available) url = res.url;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to resolve compare URL.");
        return;
      }
    }
    if (!url) {
      toast.error("Compare URL not available for this remote.");
      return;
    }
    await openExternal(url);
  }, [snapshot?.compare_url, featureId]);

  const runAction = useCallback(
    (action: GitAction) => {
      setPopoverOpen(false);
      if (state.disabled[action] !== null) return;
      if (action === "commit") setCommitOpen(true);
      else if (action === "push") openPush();
      else if (action === "merge") setMergeOpen(true);
      else void runOpenCompare();
    },
    [state.disabled, openPush, runOpenCompare],
  );

  // Keyboard shortcuts for header actions.
  useShortcut("git-commit", (e) => {
    // Mod+Shift+K is also "Delete line" inside the editor buffer. Let the
    // buffer keymap win when focus is in CodeMirror.
    if (isInCodeMirrorEditor(e.target)) return;
    if (state.disabled.commit !== null) return;
    e.preventDefault();
    setCommitOpen(true);
  });
  useShortcut("git-push", (e) => {
    if (state.disabled.push !== null) return;
    e.preventDefault();
    openPush();
  });
  useShortcut("git-pr", (e) => {
    if (state.disabled.pr !== null) return;
    e.preventDefault();
    void runOpenCompare();
  });
  useGlobalShortcutById("git-actions", (e) => {
    e.preventDefault();
    setPopoverOpen(true);
  });

  const PrimaryIcon = state.primary ? ICONS[state.primary] : GitCommit;
  const primaryDisabled = state.primary === null;

  return (
    <>
      <div className="inline-flex items-center">
        <Button
          variant="outline"
          size="xs"
          className={`${GIT_ACTION_BUTTON_CLASS} rounded-r-none border-r-0`}
          disabled={primaryDisabled}
          onClick={() => state.primary && runAction(state.primary)}
          title={primaryDisabled ? (state.disabled.commit ?? state.label) : state.label}
        >
          <PrimaryIcon className="size-3.5" />
          <span>{state.label}</span>
        </Button>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <ShortcutTooltip label="Git actions" keys={["cmd", "G"]}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="xs"
                className={`${GIT_ACTION_BUTTON_CLASS} rounded-l-none px-1.5`}
                aria-label="More git actions"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </PopoverTrigger>
          </ShortcutTooltip>
          <PopoverContent align="end" className="w-80 p-0">
            <GitActionPopover state={state} onPick={runAction} />
          </PopoverContent>
        </Popover>
      </div>
      <Suspense fallback={null}>
        {commitOpen && (
          <CommitDialog featureId={featureId} open={commitOpen} onOpenChange={setCommitOpen} />
        )}
        {pushOpen && (
          <PushDialog featureId={featureId} open={pushOpen} onOpenChange={setPushOpen} />
        )}
        {mergeOpen && (
          <MergeDialog featureId={featureId} open={mergeOpen} onOpenChange={setMergeOpen} />
        )}
      </Suspense>
    </>
  );
});
