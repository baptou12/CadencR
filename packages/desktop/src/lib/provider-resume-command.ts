import { PROVIDER_IDS } from "./providers";

export interface ResumeCommandInput {
  providerId: string | undefined;
  sessionId: string;
  cwd: string | undefined;
}

export interface ResumeCommandResult {
  command: string;
  supported: boolean;
}

function quote(value: string): string {
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")}"`;
}

function withCd(command: string, cwd: string | undefined): string {
  return cwd ? `cd ${quote(cwd)} && ${command}` : command;
}

export function buildResumeCommand({
  providerId,
  sessionId,
  cwd,
}: ResumeCommandInput): ResumeCommandResult {
  switch (providerId) {
    case PROVIDER_IDS.CLAUDE_CODE:
      return {
        command: withCd(`claude --resume ${quote(sessionId)}`, cwd),
        supported: true,
      };
    case PROVIDER_IDS.OPENCODE:
      return {
        command: withCd(`opencode --session ${quote(sessionId)}`, cwd),
        supported: true,
      };
    case PROVIDER_IDS.CODEX_CLI:
      return {
        command: withCd(`codex resume ${quote(sessionId)}`, cwd),
        supported: true,
      };
    case PROVIDER_IDS.CURSOR:
      return {
        command: withCd(`agent --resume ${quote(sessionId)}`, cwd),
        supported: true,
      };
    default:
      return {
        command: "",
        supported: false,
      };
  }
}
