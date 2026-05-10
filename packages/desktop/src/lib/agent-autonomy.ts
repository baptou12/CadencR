import { Hand, Rocket, StepForward, type LucideIcon } from "lucide-react";

export const AGENT_AUTONOMY_KEY = "agent_autonomy";

export const AGENT_AUTONOMY_VALUES = ["1", "2", "3"] as const;
export type AgentAutonomy = (typeof AGENT_AUTONOMY_VALUES)[number];

export const DEFAULT_AGENT_AUTONOMY: AgentAutonomy = "1";

export interface AgentAutonomyOption {
  value: AgentAutonomy;
  label: string;
  description: string;
  icon: LucideIcon;
  /** CSS variable for the icon's accent color, e.g. `var(--acc-green)`. */
  iconColorVar: string;
}

export const AGENT_AUTONOMY_OPTIONS: readonly AgentAutonomyOption[] = [
  {
    value: "1",
    label: "Low",
    description: "Ask before each commit.",
    icon: Hand,
    iconColorVar: "var(--acc-green)",
  },
  {
    value: "2",
    label: "Medium",
    description: "Manual continue between steps.",
    icon: StepForward,
    iconColorVar: "var(--acc-yellow)",
  },
  {
    value: "3",
    label: "High",
    description: "Full auto, end-to-end.",
    icon: Rocket,
    iconColorVar: "var(--acc-pink)",
  },
] as const;

export function parseAgentAutonomy(value: string | null | undefined): AgentAutonomy {
  return AGENT_AUTONOMY_VALUES.includes(value as AgentAutonomy)
    ? (value as AgentAutonomy)
    : DEFAULT_AGENT_AUTONOMY;
}
