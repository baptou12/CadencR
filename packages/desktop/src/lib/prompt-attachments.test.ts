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

  it("allows Codex images, PDFs, and Excel workbooks through app-server file references", () => {
    expect(getAttachmentKindForProvider("codex_cli", "diagram.jpg", "image/jpeg")).toBe("image");
    expect(getAttachmentKindForProvider("codex_cli", "brief.pdf", "application/pdf")).toBe(
      "document",
    );
    expect(
      getAttachmentKindForProvider(
        "codex_cli",
        "budget.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("document");
    expect(
      getAttachmentKindForProvider("codex_cli", "legacy.xls", "application/vnd.ms-excel"),
    ).toBe("document");
    expect(getAttachmentKindForProvider("codex_cli", "data.csv", "text/csv")).toBeNull();
  });

  it("keeps Cursor ACP attachments image-only", () => {
    expect(getAttachmentKindForProvider("cursor", "diagram.png", "image/png")).toBe("image");
    expect(getAttachmentKindForProvider("cursor", "brief.pdf", "application/pdf")).toBeNull();
    expect(attachmentAcceptForProvider("cursor")).toBe("image/png,image/jpeg,image/gif,image/webp");
    expect(unsupportedAttachmentDescription("cursor")).toContain("Cursor ACP accepts image");
  });

  it("builds provider-specific file picker accept lists and descriptions", () => {
    expect(attachmentAcceptForProvider("codex_cli")).toBe(
      "image/png,image/jpeg,image/gif,image/webp,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(attachmentAcceptForProvider("claude_code")).toContain("application/pdf");
    expect(attachmentAcceptForProvider("opencode")).toContain("audio/wav");
    expect(unsupportedAttachmentDescription("codex_cli")).toContain(
      "Codex accepts images, PDFs, and Excel spreadsheets",
    );
  });
});
