import type { WebContents } from "electron";
import { flashHighlight } from "./browser-dom";
import { expectScriptResult, isRecord } from "./browser-manager-utils";
import {
  fillTargetScript,
  resolveTargetScript,
  waitForScript,
  type BrowserTarget,
} from "./browser-target-script";
import type { BrowserBounds } from "./browser-types";

export type { BrowserTarget };

export interface ResolvedTarget {
  boundingBox: BrowserBounds;
  center: { x: number; y: number };
}

export interface BrowserWaitResult {
  found: boolean;
  elapsedMs: number;
}

export const DEFAULT_WAIT_TIMEOUT_MS = 5_000;

export async function resolveTarget(
  wc: WebContents,
  target: BrowserTarget,
): Promise<ResolvedTarget> {
  const result = await wc.executeJavaScript(resolveTargetScript(target), true);
  return expectScriptResult<ResolvedTarget>(
    result,
    (r) => r.found === true && isRecord(r.boundingBox) && isRecord(r.center),
    "Browser target could not be resolved.",
  );
}

export async function clickTarget(wc: WebContents, target: BrowserTarget): Promise<ResolvedTarget> {
  const resolved = await resolveTarget(wc, target);
  await flashHighlight(wc, resolved.boundingBox);
  const { x, y } = resolved.center;
  wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  return resolved;
}

export async function hoverTarget(wc: WebContents, target: BrowserTarget): Promise<ResolvedTarget> {
  const resolved = await resolveTarget(wc, target);
  await flashHighlight(wc, resolved.boundingBox);
  wc.sendInputEvent({ type: "mouseMove", x: resolved.center.x, y: resolved.center.y });
  return resolved;
}

export async function fillTarget(
  wc: WebContents,
  target: BrowserTarget,
  value: string,
): Promise<void> {
  const result = await wc.executeJavaScript(fillTargetScript(target, value), true);
  expectScriptResult(result, (r) => r.ok === true, "Browser fill failed.");
}

export async function waitFor(
  wc: WebContents,
  opts: { selector?: string; text?: string },
  timeoutMs: number = DEFAULT_WAIT_TIMEOUT_MS,
): Promise<BrowserWaitResult> {
  const result = await wc.executeJavaScript(
    waitForScript(opts.selector, opts.text, timeoutMs),
    true,
  );
  return expectScriptResult<BrowserWaitResult>(
    result,
    (r) => typeof r.found === "boolean" && typeof r.elapsedMs === "number",
    "Browser wait_for returned an unexpected result.",
  );
}

// Resolves once the active navigation settles (or after `timeoutMs`), so
// browser_open_url returns a loaded page instead of about:blank.
export function waitForLoad(wc: WebContents, timeoutMs = 10_000): Promise<void> {
  if (!wc.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      wc.off("did-stop-loading", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    wc.once("did-stop-loading", done);
  });
}
