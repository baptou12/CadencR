export const AGENT_VERBOSITY_SETTING_KEY = "agent_stream_verbosity_mode";

export const AGENT_VERBOSITY_MODES = ["maximal", "auto_collapse", "masonry"] as const;

export type AgentVerbosityMode = (typeof AGENT_VERBOSITY_MODES)[number];

export function parseAgentVerbosityMode(value: string | null | undefined): AgentVerbosityMode {
  if (value === "auto_collapse" || value === "masonry" || value === "maximal") {
    return value;
  }
  return "maximal";
}

export function isToolAutoCollapsible(toolName: string | undefined): boolean {
  if (!toolName) return false;
  return toolName === "Bash" || toolName === "Edit" || toolName === "Write";
}

