/**
 * Commit dialog: message + per-file checkboxes.
 *
 * - Lazy-loaded from `GitActionButton` so its uncommitted-file query and
 *   children only mount when actually opened.
 * - Per `error-handling.md`, surface the backend's stderr inline; never
 *   silently swallow.
 * - Per `no-optimistic-updates.md`, we don't manually invalidate after
 *   success — the WS `git.status` envelope drives invalidation.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { KbdShortcut } from "@/components/KbdShortcut";
import { useCommit, useGetUncommittedFiles } from "@/api/generated";
import { useCommitOutputStore } from "@/stores/useCommitOutputStore";
import { CommitOutputPane } from "./CommitOutputPane";
import { UncommittedFileList } from "./UncommittedFileList";

// Hoisted so the `keys` prop is reference-stable across the dialog's many
// re-renders (streaming output, file-list refetch, etc.).
const ESC_KEYS: string[] = ["esc"];
const SUBMIT_KEYS: string[] = ["cmd", "enter"];

interface CommitDialogProps {
  featureId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CommitDialog({
  featureId,
  open,
  onOpenChange,
}: CommitDialogProps): ReactElement {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // `failed` drives the terminal frame's red border + "commit failed" subtitle.
  // We deliberately don't keep a separate error string in component state —
  // the streamed buffer in `useCommitOutputStore` is the single error display.
  const [failed, setFailed] = useState(false);

  const filesQuery = useGetUncommittedFiles(
    { feature_id: featureId },
    { query: { enabled: open } },
  );
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);

  // Default-select every file ONCE per dialog-open. After the first load,
  // a refetch (same RQ key, fresh data) used to reset the user's
  // de-selections — that wiped legitimate intent every time the WS
  // `git.status` envelope invalidated `/api/git/uncommitted-files`.
  //
  // Behavior now (P2.6 — "default-select seulement à l'ouverture / premier
  // load, puis intersecter avec les paths encore présents"):
  //   - first time files arrive while open → default-select every path,
  //   - subsequent file-list updates → intersect prior selection with the
  //     new path set, then default-select any genuinely-new paths (paths
  //     we've never seen this session). Deselected paths that simply
  //     reappear in the refetch stay deselected.
  // Both refs are reset on close (see the cleanup effect below).
  const firstLoadDoneRef = useRef(false);
  const seenPathsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    if (filesQuery.isLoading) return;
    const paths = new Set(files.map((f) => f.path));
    if (!firstLoadDoneRef.current) {
      firstLoadDoneRef.current = true;
      seenPathsRef.current = new Set(paths);
      setSelected(paths);
      return;
    }
    const seen = seenPathsRef.current;
    setSelected((prev) => {
      const next = new Set<string>();
      // Keep prior selections that still exist in the new file list.
      for (const p of prev) if (paths.has(p)) next.add(p);
      // Default-select paths we've genuinely never seen before this
      // session. A path that was previously seen but isn't in `prev`
      // was deselected by the user — leave it deselected.
      for (const p of paths) if (!seen.has(p)) next.add(p);
      return next;
    });
    // Update the seen set last so the next refetch can tell apart
    // brand-new from previously-deselected.
    for (const p of paths) seen.add(p);
  }, [open, files, filesQuery.isLoading]);

  // Reset transient state when the dialog closes. The streaming output
  // buffer also belongs to this dialog instance — wipe it so reopening
  // doesn't show the previous run's terminal.
  useEffect(() => {
    if (open) return;
    setMessage("");
    setFailed(false);
    setSelected(new Set());
    firstLoadDoneRef.current = false;
    seenPathsRef.current = new Set();
    useCommitOutputStore.getState().reset(featureId);
  }, [open, featureId]);

  const commit = useCommit();
  const submitting = commit.isPending;
  const hasMessage = message.trim().length > 0;
  const hasSelection = selected.size > 0;
  const canSubmit = hasMessage && hasSelection && !submitting && !filesQuery.isLoading;

  function toggle(path: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;
    setFailed(false);
    // Clear the streaming buffer up-front *and* immediately mark the run
    // as "running". `BashBlock` then renders its built-in spinner +
    // "Running…" placeholder so the user has instant feedback —
    // critical for diagnosing whether streaming is working at all.
    // The backend's `commit.start` envelope re-asserts both states when
    // it arrives. If the HTTP request fails before backend processing
    // (network error, sync 4xx), no envelope ever lands and we'd
    // otherwise stack the new error on top of the previous run's log.
    const store = useCommitOutputStore.getState();
    store.reset(featureId);
    store.start(featureId);
    try {
      const result = await commit.mutateAsync({
        data: {
          feature_id: featureId,
          message: message.trim(),
          file_paths: Array.from(selected),
        },
      });
      if (!result.success) {
        // Backend returned 200 but signalled failure. The streaming pane
        // already displays the live `commit.output` lines (incl. the final
        // git error). Just mark failed so the terminal frame switches to
        // its error chrome — no separate error UI.
        showError(result.error ?? "Commit failed.");
        return;
      }
      toast.success("Committed");
      onOpenChange(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Commit failed.");
    }
  }

  /**
   * Surface an error inside the terminal frame. If the WS pipeline already
   * streamed lines (the typical case — pre-commit hook output, real git
   * stderr), we just append the final summary so the user sees both the
   * live log *and* a clear failure footer. If nothing streamed (sync HTTP
   * failure, network error), we synthesize a minimal "session" so the frame
   * has something to show — the alternative would be a separate `<pre>`
   * surface which the user explicitly rejected.
   */
  function showError(detail: string): void {
    const store = useCommitOutputStore.getState();
    const existing = store.byFeature[featureId] ?? "";
    if (existing.length === 0) {
      store.start(featureId);
    }
    store.append(featureId, `\n${detail}\n`);
    store.complete(featureId);
    setFailed(true);
  }

  // ⌘+Enter / Ctrl+Enter submits from anywhere inside the dialog (textarea,
  // file list, output pane). A bare Enter inside the textarea must still
  // insert a newline, so we gate on the modifier and keep the textarea's
  // default behaviour otherwise. We attach the listener to `DialogContent`
  // rather than the textarea so the shortcut fires regardless of which
  // element holds focus — useful once the user has tabbed into a checkbox
  // or the bash block.
  function handleDialogKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "Enter") return;
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void handleSubmit();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Two fixes layered:
          1. `!w-[…]` + `!max-w-[…]` (with `!important`) — shadcn's
             default `w-full max-w-[calc(100%-2rem)] sm:max-w-lg` would
             otherwise win the cascade and either shrink us to `lg` (32
             rem) or stretch us to viewport. We force a deterministic
             cap of 48 rem / 90 vw at every breakpoint.
          2. `min-w-0` on the children container — `DialogContent` is a
             CSS *grid*, whose items default to `min-width: auto`
             (= min-content). With a long line in `BashBlock`'s
             `<pre className="whitespace-pre">`, that min-content
             becomes huge and pushes the grid track wider than the
             dialog. `min-w-0` releases that constraint so the grid
             item can actually be 100% of the dialog and the BashBlock's
             `overflow-x-auto` body kicks in. */}
      <DialogContent
        onKeyDown={handleDialogKeyDown}
        className="!w-[min(90vw,48rem)] !max-w-[min(90vw,48rem)] sm:!max-w-[min(90vw,48rem)]"
      >
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Commit message"
            rows={3}
            autoFocus
            disabled={submitting}
          />

          {filesQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading changes…</span>
            </div>
          ) : filesQuery.isError ? (
            <p className="text-sm text-destructive">
              {filesQuery.error instanceof Error
                ? filesQuery.error.message
                : "Failed to load uncommitted files."}
            </p>
          ) : (
            <UncommittedFileList files={files} selected={selected} onToggle={toggle} />
          )}

          {/* The terminal pane is the *only* output surface for both
              success and failure. On failure the frame border turns red
              and the subtitle reads "commit failed" — the streamed log
              (incl. any synchronous error appended via `showError`)
              doubles as the error report. No parallel `<pre>` here:
              the user explicitly wants one consistent visual. */}
          <CommitOutputPane
            featureId={featureId}
            isMutationPending={submitting}
            hasFailed={failed}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
            <KbdShortcut keys={ESC_KEYS} variant="hint" />
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="size-4 animate-spin mr-2" />}
            Commit
            <KbdShortcut keys={SUBMIT_KEYS} variant="hint" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
