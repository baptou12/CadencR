import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useThemeWorkspace, type ThemeWorkspace, type UserTheme } from "@/api/generated";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { apiErrorMessage } from "@/lib/api-errors";
import { ThemeStudioAgent } from "./ThemeStudioAgent";
import { useThemeStudio, type ThemeStudioState } from "./useThemeStudio";

const ThemeStudioEditor = lazy(() => import("./ThemeStudioEditor"));

/**
 * Open a theme for editing.
 *
 * The agent half needs a conversation to live in, and that conversation is
 * created on the backend the first time a given theme is opened — so the studio
 * proper doesn't mount until those ids exist. Everything after that is local.
 */
export function ThemeStudio({
  theme,
  onClose,
}: {
  theme: UserTheme;
  onClose: () => void;
}): ReactElement {
  const workspace = useEnsuredWorkspace(theme.id, onClose);
  if (!workspace) {
    return (
      <StudioShell onOpenChange={(open) => !open && onClose()}>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-label="Opening theme" />
        </div>
      </StudioShell>
    );
  }
  return <ThemeStudioDialog theme={theme} workspace={workspace} onClose={onClose} />;
}

/** Resolve the theme's conversation exactly once per open. */
function useEnsuredWorkspace(themeId: string, onClose: () => void): ThemeWorkspace | null {
  const [workspace, setWorkspace] = useState<ThemeWorkspace | null>(null);
  const ensure = useThemeWorkspace();
  const requestedRef = useRef(false);
  // Awaited rather than handled through `mutate`'s per-call callbacks: those
  // are dropped when the observer unsubscribes before the request settles, and
  // StrictMode's simulated unmount does exactly that on the mount this fires
  // from — leaving the studio spinning forever.
  const mutateAsync = ensure.mutateAsync;
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    void mutateAsync({ id: themeId })
      .then(setWorkspace)
      .catch((error: unknown) => {
        toast.error(apiErrorMessage(error, "Failed to open the theme"));
        onClose();
      });
  }, [mutateAsync, onClose, themeId]);
  return workspace;
}

/**
 * Edit a theme with an agent beside it.
 *
 * The two halves work on the same file from opposite ends: the user types JSON
 * on the left, the agent edits the file on the right, and the app repaints from
 * whichever moved last. Dismissing — button or click-outside — restores the
 * file to what it was when the dialog opened, so experimenting is free.
 */
function ThemeStudioDialog({
  theme,
  workspace,
  onClose,
}: {
  theme: UserTheme;
  workspace: ThemeWorkspace;
  onClose: () => void;
}): ReactElement {
  const studio = useThemeStudio(theme, onClose);
  const dismiss = useCallback(
    (open: boolean): void => {
      if (!open) studio.cancel();
    },
    [studio],
  );

  return (
    <StudioShell onOpenChange={dismiss}>
      <StudioHeader studio={studio} path={theme.path} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize={52} minSize={30}>
          <Suspense fallback={<PaneSpinner label="Loading editor" />}>
            <ThemeStudioEditor studio={studio} />
          </Suspense>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={48} minSize={25} className="flex min-h-0 flex-col">
          <ThemeStudioAgent workspace={workspace} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </StudioShell>
  );
}

/** The frame both the loading and the loaded studio render into, so opening a
 *  theme doesn't resize the dialog under the pointer. */
function StudioShell({
  onOpenChange,
  children,
}: {
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[88vh] w-[94vw] max-w-none flex-col gap-0 p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Edit theme</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function StudioHeader({ studio, path }: { studio: ThemeStudioState; path: string }): ReactElement {
  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <Input
          value={studio.name}
          onChange={(event) => studio.setName(event.target.value)}
          aria-label="Theme name"
          placeholder="Theme name"
          // A name can only be written back into a document that parses; while
          // the buffer is broken the field would silently discard the edit.
          disabled={studio.previewError !== null}
          className="h-8 max-w-80 font-medium"
        />
        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{path}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" disabled={studio.isBusy} onClick={studio.cancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={studio.isBusy} onClick={studio.save}>
          {studio.isBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </header>
  );
}

function PaneSpinner({ label }: { label: string }): ReactElement {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-label={label} />
    </div>
  );
}
