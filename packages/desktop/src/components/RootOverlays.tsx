import type { Dispatch, ReactElement, SetStateAction } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { ArchiveFeatureDialog } from "@/components/ArchiveFeatureDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { Toaster } from "@/components/ui/sonner";
import { UnifiedAgentsShortcut } from "@/components/UnifiedAgentsShortcut";
import { PostUpdateChangelogDialog } from "@/components/PostUpdateChangelogDialog";
import { ThemeDrawer } from "@/components/theme/ThemeDrawer";
import { useListFeatures, useListFeatureWorktrees } from "@/api/generated";

type ConfirmAction = "archive" | "delete" | null;

interface AppCloseOverlayState {
  showConfirm: boolean;
  setShowConfirm: Dispatch<SetStateAction<boolean>>;
  confirmAndClose: () => void;
  runningAgents: Array<{ sessionId: string; label: string }>;
}

interface RootOverlaysProps {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: Dispatch<SetStateAction<boolean>>;
  activeProjectId: number | null;
  activeFeatureId: number | null;
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: Dispatch<SetStateAction<boolean>>;
  confirmAction: ConfirmAction;
  setConfirmAction: Dispatch<SetStateAction<ConfirmAction>>;
  onConfirmFeatureAction: () => void;
  appClose: AppCloseOverlayState;
}

export function RootOverlays({
  commandPaletteOpen,
  setCommandPaletteOpen,
  activeProjectId,
  activeFeatureId,
  shortcutsHelpOpen,
  setShortcutsHelpOpen,
  confirmAction,
  setConfirmAction,
  onConfirmFeatureAction,
  appClose,
}: RootOverlaysProps): ReactElement {
  const { data: features = [] } = useListFeatures(
    { project_id: activeProjectId ?? 0, include_archived: true },
    {
      query: {
        enabled: activeProjectId != null && activeFeatureId != null && confirmAction === "archive",
      },
    },
  );
  const { data: featureWorktrees = [] } = useListFeatureWorktrees(
    { project_id: activeProjectId ?? 0 },
    { query: { enabled: activeProjectId != null && confirmAction === "archive" } },
  );
  const activeFeature = features.find((feature) => feature.id === activeFeatureId);
  const activeFeatureHasLiveWorktree = featureWorktrees.some(
    (worktree) => worktree.feature_id === activeFeatureId && worktree.live,
  );

  return (
    <>
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        activeProjectId={activeProjectId}
        activeFeatureId={activeFeatureId}
      />
      <UnifiedAgentsShortcut />
      <KeyboardShortcutsModal open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
      <Toaster position="top-center" />
      <PostUpdateChangelogDialog />
      <ThemeDrawer />
      <ArchiveFeatureDialog
        open={confirmAction === "archive"}
        feature={activeFeature}
        projectId={activeProjectId ?? 0}
        hasLiveWorktree={activeFeatureHasLiveWorktree}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        onArchive={onConfirmFeatureAction}
      />
      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title="Delete archived session?"
        description="This cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={onConfirmFeatureAction}
      />
      <ConfirmDialog
        open={appClose.showConfirm}
        onOpenChange={appClose.setShowConfirm}
        title="Quit Cadencr?"
        description="The following agents are still running. They will be stopped and can be resumed next time you open the app."
        confirmText="Quit"
        variant="destructive"
        onConfirm={appClose.confirmAndClose}
      >
        <ul className="text-sm text-muted-foreground space-y-1 py-2">
          {appClose.runningAgents.map((agent) => (
            <li key={agent.sessionId}>{agent.label}</li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  );
}
