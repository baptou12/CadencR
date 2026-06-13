import {
  captureDomOutline,
  captureDomSnapshot,
  capturePageImage,
  captureRegionScreenshot,
  evaluateInPage,
  type BrowserDomOutline,
  type BrowserDomSnapshot,
  type BrowserEvalResult,
} from "./browser-dom";
import {
  clickTarget as clickTargetOnPage,
  fillTarget as fillTargetOnPage,
  hoverTarget as hoverTargetOnPage,
  resolveTarget,
  waitFor as waitForOnPage,
  type BrowserTarget,
  type BrowserWaitResult,
  type ResolvedTarget,
} from "./browser-interactions";
import { assertBrowserMutationAllowed, externalAutomationMatches } from "./browser-manager-utils";
import type { ManagedTab } from "./browser-tab-events";
import type { BrowserBounds } from "./browser-types";

// A tab approved via the external opener may be automated only while it stays on
// the approved origin; otherwise fall back to the localhost-only gate.
function assertMutatingAllowed(tab: ManagedTab): void {
  const liveUrl = tab.view.webContents.getURL();
  if (externalAutomationMatches(liveUrl, tab.externalAutomationOrigin)) return;
  assertBrowserMutationAllowed(liveUrl);
}

export function snapshotPage(
  tab: ManagedTab,
  selector?: string,
  maxLength?: number,
  format?: string,
): Promise<BrowserDomSnapshot | BrowserDomOutline> {
  const wc = tab.view.webContents;
  return format === "html"
    ? captureDomSnapshot(wc, selector, maxLength)
    : captureDomOutline(wc, selector, maxLength);
}

export function screenshotPage(tab: ManagedTab, clip?: BrowserBounds): Promise<string> {
  const wc = tab.view.webContents;
  return clip ? captureRegionScreenshot(wc, clip) : capturePageImage(wc);
}

export async function screenshotTargetPage(
  tab: ManagedTab,
  target: BrowserTarget,
): Promise<string> {
  const wc = tab.view.webContents;
  const { boundingBox } = await resolveTarget(wc, target);
  return captureRegionScreenshot(wc, boundingBox);
}

export function evaluatePage(tab: ManagedTab, script: string): Promise<BrowserEvalResult> {
  assertMutatingAllowed(tab);
  return evaluateInPage(tab.view.webContents, script);
}

export function clickPage(tab: ManagedTab, x: number, y: number): void {
  assertMutatingAllowed(tab);
  const wc = tab.view.webContents;
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

export function typeTextPage(tab: ManagedTab, text: string): void {
  assertMutatingAllowed(tab);
  tab.view.webContents.insertText(text);
}

export function keypressPage(tab: ManagedTab, keyCode: string): void {
  assertMutatingAllowed(tab);
  tab.view.webContents.sendInputEvent({ type: "keyDown", keyCode });
}

export function clickTargetPage(tab: ManagedTab, target: BrowserTarget): Promise<ResolvedTarget> {
  assertMutatingAllowed(tab);
  return clickTargetOnPage(tab.view.webContents, target);
}

export function hoverPage(tab: ManagedTab, target: BrowserTarget): Promise<ResolvedTarget> {
  assertMutatingAllowed(tab);
  return hoverTargetOnPage(tab.view.webContents, target);
}

export function fillPage(tab: ManagedTab, target: BrowserTarget, value: string): Promise<void> {
  assertMutatingAllowed(tab);
  return fillTargetOnPage(tab.view.webContents, target, value);
}

export function waitForPage(
  tab: ManagedTab,
  opts: { selector?: string; text?: string },
  timeoutMs?: number,
): Promise<BrowserWaitResult> {
  return waitForOnPage(tab.view.webContents, opts, timeoutMs);
}
