import { describe, expect, it, vi } from "vitest";
import { clickTargetPage } from "./browser-page-actions";
import type { ManagedTab } from "./browser-tab-events";

describe("browser page action authorization", () => {
  it("rechecks the live origin after target resolution before dispatching a click", async () => {
    let url = "http://localhost:3000/";
    let resolveTarget: (value: unknown) => void = () => {
      throw new Error("Target resolution did not start.");
    };
    const executeJavaScript = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveTarget = resolve;
        }),
    );
    const webContents = {
      getURL: () => url,
      executeJavaScript,
      sendInputEvent: vi.fn(),
    } as unknown as Electron.WebContents;
    const tab = {
      webContents,
      view: { webContents },
      externalAutomationOrigin: null,
    } as unknown as ManagedTab;

    const pending = clickTargetPage(tab, { ref: "e1" });
    url = "https://authenticated.example.com/account";
    resolveTarget({
      found: true,
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      center: { x: 5, y: 5 },
    });

    await expect(pending).rejects.toThrow("localhost");
    expect(webContents.sendInputEvent).not.toHaveBeenCalled();
    expect(executeJavaScript).toHaveBeenCalledOnce();
  });
});
