import { describe, it, expect } from "vitest";
import { detectSshPrompt } from "./detectSshPrompt";

describe("detectSshPrompt", () => {
  it("returns null on empty / whitespace-only buffers", () => {
    expect(detectSshPrompt("")).toBeNull();
    expect(detectSshPrompt("\n  \n")).toBeNull();
  });

  it("matches a passphrase prompt at the tail", () => {
    const buf = "$ git push -u origin HEAD\nEnter passphrase for key '/Users/x/.ssh/id_ed25519':";
    const m = detectSshPrompt(buf);
    expect(m).not.toBeNull();
    expect(m?.kind).toBe("password");
    expect(m?.text.startsWith("Enter passphrase")).toBe(true);
  });

  it("matches a remote-user password prompt", () => {
    const m = detectSshPrompt("git@example.com's password:");
    expect(m?.kind).toBe("password");
    expect(m?.text).toBe("git@example.com's password:");
  });

  it("matches a generic 'password:' prompt for HTTPS credential helpers", () => {
    const m = detectSshPrompt("password:");
    expect(m?.kind).toBe("password");
  });

  it("matches the first-time host-key confirmation as `confirm`, not `password`", () => {
    // Mixed input must not be masked — the user has to read the
    // fingerprint and type yes/no with full visibility.
    const buf =
      "The authenticity of host 'github.com' can't be established.\n" +
      "ED25519 key fingerprint is SHA256:xxx.\n" +
      "Are you sure you want to continue connecting (yes/no/[fingerprint])?";
    const m = detectSshPrompt(buf);
    expect(m?.kind).toBe("confirm");
  });

  it("matches Username prompt as confirm (visible)", () => {
    const m = detectSshPrompt("Username for 'https://github.com':");
    expect(m?.kind).toBe("confirm");
  });

  it("ignores prompt-like substrings buried in the middle of the buffer", () => {
    // A line that *looks* like a prompt but is followed by more output
    // (e.g. it was already answered earlier in the run) must not fire —
    // only the final line matters.
    const buf =
      "Enter passphrase for key '/old/key':\nEnumerating objects: 12\nWriting objects: 100%\n";
    expect(detectSshPrompt(buf)).toBeNull();
  });

  it("offset points at the start of the prompt line", () => {
    const buf = "preamble\npassword:";
    const m = detectSshPrompt(buf);
    expect(m).not.toBeNull();
    // 'password:' starts right after the `\n` at index 8 → offset = 9.
    expect(m?.offset).toBe("preamble\n".length);
    expect(buf.slice(m!.offset)).toBe("password:");
  });

  it("tolerates a trailing newline echoed by the terminal after the prompt", () => {
    // Some terminals echo `\n` after the prompt is printed; the matcher
    // strips trailing whitespace before anchoring. This must still match.
    expect(detectSshPrompt("Enter passphrase for key 'foo':\n")).not.toBeNull();
  });

  it("matches when the prompt follows a bare `\\r` instead of `\\n`", () => {
    // Real PTY output: ssh / git progress writers use `\r` to overwrite
    // the previous line in-place. If the prompt arrives right after one
    // of those (no intervening `\n`), the leading separator is just `\r`.
    // Without this case the dialog shows the prompt text but no input
    // box — the bug we hit in production on the first push.
    const buf = "Enumerating objects: 100% (5/5)\rEnter passphrase for key '/x':";
    const m = detectSshPrompt(buf);
    expect(m?.kind).toBe("password");
    expect(m?.text).toBe("Enter passphrase for key '/x':");
  });

  it("matches when the prompt follows `\\r\\n` (PTY ONLCR post-processing)", () => {
    // PTYs convert child `\n` writes into `\r\n` on the master side. The
    // matcher must anchor to the `\n` half (not stop at the `\r`) so the
    // captured offset still points at the `E` of `Enter`.
    const buf = "$ git push -u origin HEAD\r\nEnter passphrase for key '/x':";
    const m = detectSshPrompt(buf);
    expect(m).not.toBeNull();
    // The captured prompt text must not include the leading `\r`/`\n`.
    expect(m?.text.startsWith("Enter")).toBe(true);
  });
});
