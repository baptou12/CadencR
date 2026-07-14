/** A Cadencr virtual orchestration skill uses the provider's skill trigger but
 * remains distinguishable for branded rendering and MCP availability gates. */
export type SlashCommandKind = "command" | "skill" | "cadencr";

export interface SlashCommand {
  [key: string]: unknown;
  name: string;
  description: string;
  kind: SlashCommandKind;
  argumentHint?: string;
}
