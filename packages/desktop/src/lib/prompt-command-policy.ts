import type { SlashCommandKind } from "@/lib/slash-command";

export type PromptCommandTriggerChar = "/" | "$";
export type PromptCommandPlacement = "prompt_start" | "anywhere";
export type SkillReferenceTrigger = "slash" | "dollar";

export interface PromptCommandPolicy {
  slashCommandPlacement: PromptCommandPlacement;
  skillReferenceTrigger: SkillReferenceTrigger;
  userShell: boolean;
}

export interface PromptCommandPolicyPayload {
  slash_command_placement: PromptCommandPlacement;
  skill_reference_trigger: SkillReferenceTrigger;
  user_shell?: boolean;
}

export interface PromptCommandTriggerPolicy {
  triggerChar: PromptCommandTriggerChar;
  commandKindsAtPromptStart: readonly SlashCommandKind[];
  commandKindsMidPrompt: readonly SlashCommandKind[];
}

export const DEFAULT_PROMPT_COMMAND_POLICY: PromptCommandPolicy = {
  slashCommandPlacement: "prompt_start",
  skillReferenceTrigger: "slash",
  userShell: false,
};

const ALL_COMMAND_KINDS = ["command", "skill", "cadencr"] as const;
const NATIVE_COMMAND_KINDS = ["command", "skill"] as const;

// Cadencr's virtual skills are expanded by Cadencr before the message reaches
// the agent, so the provider's own placement rule for native commands (which
// exists because a CLI only parses `/compact` at the start of a turn) does not
// bind them: they stay available mid-prompt under the provider's skill trigger.
function nativeCommandKindsMidPrompt(
  policy: PromptCommandPolicy,
  skillsUseSlash: boolean,
): readonly SlashCommandKind[] {
  if (policy.slashCommandPlacement !== "anywhere") return [];
  return skillsUseSlash ? NATIVE_COMMAND_KINDS : ["command"];
}

export function promptCommandTriggers(
  policy: PromptCommandPolicy,
): readonly PromptCommandTriggerPolicy[] {
  const skillsUseSlash = policy.skillReferenceTrigger === "slash";
  const nativeMidPrompt = nativeCommandKindsMidPrompt(policy, skillsUseSlash);
  const slashTrigger: PromptCommandTriggerPolicy = {
    triggerChar: "/",
    commandKindsAtPromptStart: skillsUseSlash ? ALL_COMMAND_KINDS : ["command"],
    commandKindsMidPrompt: skillsUseSlash ? [...nativeMidPrompt, "cadencr"] : nativeMidPrompt,
  };
  if (skillsUseSlash) return [slashTrigger];
  return [
    slashTrigger,
    {
      triggerChar: "$",
      commandKindsAtPromptStart: ["skill", "cadencr"],
      commandKindsMidPrompt: ["skill", "cadencr"],
    },
  ];
}

export function supportsDollarSkillReferences(policy: PromptCommandPolicy): boolean {
  return policy.skillReferenceTrigger === "dollar";
}

export function promptCommandPolicyFromPayload(
  payload: PromptCommandPolicyPayload | undefined,
): PromptCommandPolicy {
  if (!payload) return DEFAULT_PROMPT_COMMAND_POLICY;
  return {
    slashCommandPlacement: payload.slash_command_placement,
    skillReferenceTrigger: payload.skill_reference_trigger,
    userShell: payload.user_shell ?? false,
  };
}
