import { LayoutGrid, ListTree, Minimize2 } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  AGENT_VERBOSITY_SETTING_KEY,
  AGENT_VERBOSITY_MODES,
  parseAgentVerbosityMode,
  type AgentVerbosityMode,
} from "@/lib/agent-verbosity";
import { IconTile } from "@/components/settings/IconTile";
import { SettingsRow } from "@/components/settings/SettingsRow";

const LABELS: Record<AgentVerbosityMode, string> = {
  maximal: "Maximal (default)",
  auto_collapse: "Auto-collapse (3s)",
  masonry: "Masonry tools",
};

export function AgentVerbositySettings(): React.JSX.Element {
  const modeSetting = useDebouncedSetting(AGENT_VERBOSITY_SETTING_KEY);
  const currentMode = parseAgentVerbosityMode(modeSetting.value);

  return (
    <SettingsRow
      align="start"
      icon={
        <IconTile tint="violet">
          <ListTree className="size-4" />
        </IconTile>
      }
      label="Agent output verbosity"
      description="Choose between full stream detail, timed auto-collapse for tools/thinking, or compact side-by-side tool layout."
      control={
        <div className="flex items-center gap-2">
          <select
            value={currentMode}
            onChange={(event) => modeSetting.setValue(event.target.value)}
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            aria-label="Agent output verbosity"
          >
            {AGENT_VERBOSITY_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {LABELS[mode]}
              </option>
            ))}
          </select>
          {currentMode === "maximal" && <ListTree className="size-4 text-muted-foreground" />}
          {currentMode === "auto_collapse" && (
            <Minimize2 className="size-4 text-muted-foreground" />
          )}
          {currentMode === "masonry" && <LayoutGrid className="size-4 text-muted-foreground" />}
        </div>
      }
    />
  );
}
