import { useMemo, createElement } from "react";
import { RadioCardGroup, type RadioCardOption } from "./RadioCardGroup";
import { AGENT_AUTONOMY_OPTIONS, type AgentAutonomy } from "@/lib/agent-autonomy";

/**
 * Three-card autonomy picker (Low / Medium / High) used both in the
 * workspace Settings page and the Project Settings modal. Centralizes the
 * option list and the icon styling so the two surfaces never drift.
 */
export function AutonomyRadio({
  value,
  onChange,
  disabled,
}: {
  value: AgentAutonomy;
  onChange: (next: AgentAutonomy) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const options = useMemo<RadioCardOption<AgentAutonomy>[]>(
    () =>
      AGENT_AUTONOMY_OPTIONS.map((option) => ({
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
    <RadioCardGroup<AgentAutonomy>
      ariaLabel="Agent autonomy"
      value={value}
      onChange={onChange}
      options={options}
      layout="grid"
      columns={3}
      showDot={false}
      disabled={disabled}
    />
  );
}
