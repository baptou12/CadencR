import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_COMMAND_POLICY,
  promptCommandTriggers,
  supportsDollarSkillReferences,
  type PromptCommandPolicy,
} from "./prompt-command-policy";

describe("prompt command policy", () => {
  it("projects slash-native skills with provider-controlled placement", () => {
    const anywhere: PromptCommandPolicy = {
      slashCommandPlacement: "anywhere",
      skillReferenceTrigger: "slash",
      userShell: true,
    };

    expect(promptCommandTriggers(anywhere)).toEqual([
      {
        triggerChar: "/",
        commandKindsAtPromptStart: ["command", "skill", "cadencr"],
        commandKindsMidPrompt: ["command", "skill"],
      },
    ]);
    expect(promptCommandTriggers(DEFAULT_PROMPT_COMMAND_POLICY)[0].commandKindsMidPrompt).toEqual(
      [],
    );
    expect(supportsDollarSkillReferences(anywhere)).toBe(false);
  });

  it("projects dollar skill references separately from slash commands", () => {
    const policy: PromptCommandPolicy = {
      slashCommandPlacement: "prompt_start",
      skillReferenceTrigger: "dollar",
      userShell: true,
    };

    expect(promptCommandTriggers(policy)).toEqual([
      {
        triggerChar: "/",
        commandKindsAtPromptStart: ["command"],
        commandKindsMidPrompt: [],
      },
      {
        triggerChar: "$",
        commandKindsAtPromptStart: ["skill", "cadencr"],
        commandKindsMidPrompt: ["skill"],
      },
    ]);
    expect(supportsDollarSkillReferences(policy)).toBe(true);
  });
});
