import { describe, it, expect } from "vitest";
import { buildResumeCommand } from "./provider-resume-command";
import { PROVIDER_IDS } from "./providers";

describe("buildResumeCommand", () => {
  it("builds claude_code resume command with cwd", () => {
    const result = buildResumeCommand({
      providerId: PROVIDER_IDS.CLAUDE_CODE,
      sessionId: "11111111-1111-4111-8111-111111111111",
      cwd: "/home/user/project",
    });
    expect(result.supported).toBe(true);
    expect(result.command).toBe(
      'cd "/home/user/project" && claude --resume "11111111-1111-4111-8111-111111111111"',
    );
  });

  it("omits cd when cwd is missing for claude_code", () => {
    const result = buildResumeCommand({
      providerId: PROVIDER_IDS.CLAUDE_CODE,
      sessionId: "abc",
      cwd: undefined,
    });
    expect(result.command).toBe('claude --resume "abc"');
    expect(result.supported).toBe(true);
  });

  it("escapes double quotes in cwd", () => {
    const result = buildResumeCommand({
      providerId: PROVIDER_IDS.CLAUDE_CODE,
      sessionId: "abc",
      cwd: '/tmp/weird"dir',
    });
    expect(result.command).toBe('cd "/tmp/weird\\"dir" && claude --resume "abc"');
  });

  it("escapes shell metacharacters in resume ids", () => {
    const result = buildResumeCommand({
      providerId: PROVIDER_IDS.CODEX_CLI,
      sessionId: 'abc"; echo $HOME `pwd`',
      cwd: "/tmp",
    });
    expect(result.command).toBe('cd "/tmp" && codex resume "abc\\"; echo \\$HOME \\`pwd\\`"');
  });

  it("builds opencode resume command with --session flag", () => {
    const result = buildResumeCommand({
      providerId: PROVIDER_IDS.OPENCODE,
      sessionId: "ses_abc123",
      cwd: "/home/user/project",
    });
    expect(result.supported).toBe(true);
    expect(result.command).toBe('cd "/home/user/project" && opencode --session "ses_abc123"');
  });

  it("builds codex resume command", () => {
    const result = buildResumeCommand({
      providerId: PROVIDER_IDS.CODEX_CLI,
      sessionId: "abc",
      cwd: "/tmp",
    });
    expect(result.supported).toBe(true);
    expect(result.command).toBe('cd "/tmp" && codex resume "abc"');
  });

  it("marks missing provider as unsupported", () => {
    const result = buildResumeCommand({
      providerId: undefined,
      sessionId: "abc",
      cwd: "/tmp",
    });
    expect(result.supported).toBe(false);
  });
});
