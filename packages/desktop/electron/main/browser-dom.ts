import type { WebContents } from "electron";
import { elementContextScript } from "./browser-element-context-script";
import { domSnapshotScript, flashHighlightScript } from "./browser-dom-script";
import { domOutlineScript } from "./browser-outline-script";
import { expectScriptResult, isElementPayload, isRecord } from "./browser-manager-utils";
import { captureScreenshotParams } from "./browser-screenshot";
import type { BrowserBounds, BrowserElementContext } from "./browser-types";

export interface BrowserDomSnapshot {
  found: boolean;
  selector: string | null;
  url?: string;
  title?: string;
  length?: number;
  truncated?: boolean;
  html?: string;
  error?: string;
}

export interface BrowserEvalResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface BrowserDomOutline {
  found: boolean;
  selector: string | null;
  url?: string;
  title?: string;
  length?: number;
  refCount?: number;
  truncated?: boolean;
  outline?: string;
  error?: string;
}

export const DEFAULT_DOM_MAX_LENGTH = 500_000;
export const DEFAULT_OUTLINE_MAX_LENGTH = 40_000;

async function cdp(
  wc: WebContents,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const dbg = wc.debugger;
  if (!dbg.isAttached()) dbg.attach("1.3");
  return dbg.sendCommand(method, params);
}

export async function captureScreenshot(wc: WebContents, clip?: BrowserBounds): Promise<string> {
  const result = await cdp(wc, "Page.captureScreenshot", captureScreenshotParams(clip));
  if (isRecord(result) && typeof result.data === "string") return result.data;
  throw new Error("Browser screenshot did not return image data.");
}

export async function captureDomSnapshot(
  wc: WebContents,
  selector?: string,
  maxLength: number = DEFAULT_DOM_MAX_LENGTH,
): Promise<BrowserDomSnapshot> {
  const result = await wc.executeJavaScript(domSnapshotScript(selector, maxLength), true);
  return expectScriptResult<BrowserDomSnapshot>(
    result,
    (r) => typeof r.found === "boolean",
    "Browser DOM snapshot capture failed.",
  );
}

export async function captureDomOutline(
  wc: WebContents,
  selector?: string,
  maxLength: number = DEFAULT_OUTLINE_MAX_LENGTH,
): Promise<BrowserDomOutline> {
  const result = await wc.executeJavaScript(domOutlineScript(selector, maxLength), true);
  return expectScriptResult<BrowserDomOutline>(
    result,
    (r) => typeof r.found === "boolean",
    "Browser outline capture failed.",
  );
}

// Capture a clipped region, then flash the same region so the user sees live
// which part of the page the agent grabbed. The flash is drawn after capture so
// it never appears in the returned image.
export async function captureRegionScreenshot(
  wc: WebContents,
  clip: BrowserBounds,
): Promise<string> {
  const data = await captureScreenshot(wc, clip);
  await flashHighlight(wc, clip);
  return data;
}

export async function flashHighlight(wc: WebContents, bounds: BrowserBounds): Promise<void> {
  // The highlight is a live visual cue, not part of the agent's result. A
  // failure (e.g. the tab navigated mid-capture) must not break the snapshot or
  // screenshot, so report it to the console instead of throwing.
  try {
    await wc.executeJavaScript(flashHighlightScript(bounds), true);
  } catch (error) {
    console.warn("Browser highlight overlay failed:", error);
  }
}

export async function evaluateInPage(wc: WebContents, script: string): Promise<BrowserEvalResult> {
  try {
    const result = await wc.executeJavaScript(script, true);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function captureElementContext(
  wc: WebContents,
  meta: { tabId: string; url: string; title: string; capturedAt: string },
  diagnostics: BrowserElementContext["diagnostics"],
): Promise<BrowserElementContext> {
  const context = await wc.executeJavaScript(elementContextScript(), true);
  if (!isElementPayload(context)) throw new Error("Browser element context capture failed.");
  const screenshotPngBase64 = await captureScreenshot(wc, context.boundingBox);
  return { ...meta, screenshotPngBase64, element: context, diagnostics };
}
