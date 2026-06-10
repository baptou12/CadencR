import { describe, expect, it } from "vitest";
import {
  attachmentAcceptForProvider,
  getAttachmentKindForProvider,
  unsupportedAttachmentDescription,
} from "./prompt-attachments";

describe("prompt attachment provider support", () => {
  it("allows Claude Code images, PDFs, and text-like files", () => {
    expect(getAttachmentKindForProvider("claude_code", "diagram.png", "image/png")).toBe("image");
    expect(getAttachmentKindForProvider("claude_code", "brief.pdf", "application/pdf")).toBe(
      "document",
    );
    expect(getAttachmentKindForProvider("claude_code", "data.csv", "text/csv")).toBe("text");
  });

  it("allows OpenCode ACP image, audio, and embedded resources", () => {
    expect(getAttachmentKindForProvider("opencode", "diagram.webp", "image/webp")).toBe("image");
    expect(getAttachmentKindForProvider("opencode", "clip.wav", "audio/wav")).toBe("audio");
    expect(getAttachmentKindForProvider("opencode", "brief.pdf", "application/pdf")).toBe(
      "resource",
    );
  });

  it("allows Codex images and PDFs through app-server file references", () => {
    expect(getAttachmentKindForProvider("codex_cli", "diagram.jpg", "image/jpeg")).toBe("image");
    expect(getAttachmentKindForProvider("codex_cli", "brief.pdf", "application/pdf")).toBe(
      "document",
    );
    expect(getAttachmentKindForProvider("codex_cli", "data.csv", "text/csv")).toBeNull();
  });

  it("builds provider-specific file picker accept lists and descriptions", () => {
    expect(attachmentAcceptForProvider("codex_cli")).toBe(
      "image/png,image/jpeg,image/gif,image/webp,application/pdf",
    );
    expect(attachmentAcceptForProvider("claude_code")).toContain("application/pdf");
    expect(attachmentAcceptForProvider("opencode")).toContain("audio/wav");
    expect(unsupportedAttachmentDescription("codex_cli")).toContain(
      "Codex accepts images and PDFs",
    );
  });
});
