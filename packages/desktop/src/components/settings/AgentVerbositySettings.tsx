import { createElement, useMemo } from "react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  AGENT_VERBOSITY_OPTIONS,
  AGENT_VERBOSITY_SETTING_KEY,
  parseAgentVerbosityMode,
  type AgentVerbosityMode,
} from "@/lib/agent-verbosity";
import { RadioCardGroup, type RadioCardOption } from "@/components/settings/RadioCardGroup";

export function AgentVerbositySettings(): React.JSX.Element {
  const modeSetting = useDebouncedSetting(AGENT_VERBOSITY_SETTING_KEY, 0);
  const currentMode = parseAgentVerbosityMode(modeSetting.value);

  const options = useMemo<RadioCardOption<AgentVerbosityMode>[]>(
    () =>
      AGENT_VERBOSITY_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
        visual: createElement(option.icon, {
          className: "mt-0.5 size-4",
          style: { color: option.iconColorVar },
        }),
      })),
    [],
  );

  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-card/30 p-3">
      <div>
        <div className="text-sm font-medium">Agent output verbosity</div>
        <p className="text-xs text-muted-foreground">
          Control how much of each agent turn stays expanded in the stream. Switching modes does not
          affect what the agent does — only how its output is rendered.
        </p>
      </div>
      <RadioCardGroup<AgentVerbosityMode>
        ariaLabel="Agent output verbosity"
        value={currentMode}
        onChange={modeSetting.setValue}
        options={options}
        layout="stack"
        showDot={false}
        disabled={modeSetting.isLoading}
      />
    </div>
  );
}
