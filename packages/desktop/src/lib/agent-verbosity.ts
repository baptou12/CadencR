import { ListTree, Minimize2, type LucideIcon } from "lucide-react";

export const AGENT_VERBOSITY_SETTING_KEY = "agent_stream_verbosity_mode";

export const AGENT_VERBOSITY_MODES = ["maximal", "auto_collapse"] as const;

export type AgentVerbosityMode = (typeof AGENT_VERBOSITY_MODES)[number];

export const DEFAULT_AGENT_VERBOSITY_MODE: AgentVerbosityMode = "maximal";

/** Delay before a finished block auto-collapses in `auto_collapse` mode. */
export const AGENT_AUTO_COLLAPSE_DELAY_MS = 3000;

export interface AgentVerbosityOption {
  value: AgentVerbosityMode;
  label: string;
  description: string;
  icon: LucideIcon;
  iconColorVar: string;
}

export const AGENT_VERBOSITY_OPTIONS: readonly AgentVerbosityOption[] = [
  {
    value: "maximal",
    label: "Maximal",
    description:
      "Show every tool call, thinking step, and command output expanded by default. Best for inspecting agent behavior in detail.",
    icon: ListTree,
    iconColorVar: "var(--acc-blue)",
  },
  {
    value: "auto_collapse",
    label: "Auto-collapse",
    description:
      "After a turn finishes, fold Bash output and thinking blocks so the stream stays scannable. Click any block to re-expand.",
    icon: Minimize2,
    iconColorVar: "var(--acc-yellow)",
  },
] as const;

export function parseAgentVerbosityMode(value: string | null | undefined): AgentVerbosityMode {
  return AGENT_VERBOSITY_MODES.includes(value as AgentVerbosityMode)
    ? (value as AgentVerbosityMode)
    : DEFAULT_AGENT_VERBOSITY_MODE;
}

/**
 * Tools whose output participates in auto-collapse. Only tools whose render
 * path threads the controlled `expanded` prop are included — listing a tool
 * here without wiring the prop is a silent no-op.
 */
export function isToolAutoCollapsible(toolName: string | undefined): boolean {
  return toolName === "Bash";
}
