import type { Dispatch, ReactElement, SetStateAction } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { Toaster } from "@/components/ui/sonner";
import { UnifiedAgentsShortcut } from "@/components/UnifiedAgentsShortcut";

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
      <Toaster position="top-center" richColors />
      <ConfirmDialog
        open={confirmAction != null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction === "archive" ? "Archive session?" : "Delete archived session?"}
        description={confirmAction === "delete" ? "This cannot be undone." : undefined}
        confirmText={confirmAction === "archive" ? "Archive" : "Delete"}
        variant={confirmAction === "archive" ? "default" : "destructive"}
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
