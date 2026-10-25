import { Keyboard, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useZoom } from "@/hooks/useZoom";
import { useShortcutsHelpStore } from "@/stores/shortcuts-help-store";
import { ResolvedKbdChord } from "@/components/KbdShortcut";
import { AutoLayoutDefaultSetting } from "./AutoLayoutDefaultSetting";
import { AgentMessageNavigatorSetting } from "./AgentMessageNavigatorSetting";
import { IconTile } from "./IconTile";
import { SettingsCard } from "./SettingsCard";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

export function InterfaceSection(): React.JSX.Element {
  const { zoomLevel, zoomIn, zoomOut, resetZoom } = useZoom();
  // Desktop and mobile keep independent zoom levels, so this control only ever
  // shows (and edits) the option for the device type it's running on.
  const isMobile = useIsMobile();
  // Action only — selecting the setter (never the open flag) keeps this row
  // from re-rendering when the modal toggles.
  const openShortcutsHelp = useShortcutsHelpStore((s) => s.setOpen);

  return (
    <SettingsSection
      id="interface"
      title="Interface & Zoom"
      subtitle="Agent tab · Auto layout · UI scaling · Keyboard"
    >
      <SettingsCard>
        <SettingsRow
          align="start"
          icon={
            <IconTile tint="cyan">
              <ZoomIn className="size-4" />
            </IconTile>
          }
          label="UI zoom"
          description={
            isMobile ? (
              "Scales the interface on this device only. This is separate from the desktop app's zoom."
            ) : (
              <>
                Affects sidebar, editor, terminal, and chrome together.
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <ResolvedKbdChord shortcutId="zoom-in" />
                  <ResolvedKbdChord shortcutId="zoom-out" />
                  <ResolvedKbdChord shortcutId="zoom-reset" />
                  work everywhere.
                </span>
              </>
            )
          }
          control={
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="size-7 p-0" onClick={zoomOut}>
                −
              </Button>
              <span className="w-14 text-center text-sm tabular-nums">{zoomLevel}%</span>
              <Button variant="outline" size="sm" className="size-7 p-0" onClick={zoomIn}>
                +
              </Button>
              <Button variant="ghost" size="sm" onClick={resetZoom}>
                Reset
              </Button>
            </div>
          }
        />
        <SettingsRow
          divided
          icon={
            <IconTile tint="purple">
              <Keyboard className="size-4" />
            </IconTile>
          }
          label="Keyboard shortcuts"
          description={
            <span className="flex flex-wrap items-center gap-1.5">
              Browse every shortcut, or press
              <ResolvedKbdChord shortcutId="shortcuts-help" />
              anywhere.
            </span>
          }
          control={
            <Button variant="outline" size="sm" onClick={() => openShortcutsHelp(true)}>
              View shortcuts
            </Button>
          }
        />
        <AgentMessageNavigatorSetting />
        {!isMobile && <AutoLayoutDefaultSetting />}
      </SettingsCard>
    </SettingsSection>
  );
}
