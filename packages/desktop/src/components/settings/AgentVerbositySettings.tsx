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
    <RadioCardGroup<AgentVerbosityMode>
      ariaLabel="Agent output verbosity"
      value={currentMode}
      onChange={modeSetting.setValue}
      options={options}
      layout="stack"
      showDot={false}
      disabled={modeSetting.isLoading}
    />
  );
}
