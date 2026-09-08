import { describe, expect, it, vi } from "vitest";
import type { BrowserDownloadManager } from "./browser-download-manager";
import { prepareBrowserShutdown } from "./browser-manager-downloads";

describe("prepareBrowserShutdown", () => {
  it("resumes download acceptance when workspace shutdown preparation fails", async () => {
    const prepareForShutdown = vi.fn(async () => undefined);
    const resumeAfterShutdownAbort = vi.fn();
    const downloads = {
      prepareForShutdown,
      resumeAfterShutdownAbort,
    } as unknown as BrowserDownloadManager;
    const workspaceError = new Error("workspace flush failed");

    await expect(
      prepareBrowserShutdown(downloads, async () => {
        throw workspaceError;
      }),
    ).rejects.toBe(workspaceError);

    expect(prepareForShutdown).toHaveBeenCalledOnce();
    expect(resumeAfterShutdownAbort).toHaveBeenCalledOnce();
  });
});
