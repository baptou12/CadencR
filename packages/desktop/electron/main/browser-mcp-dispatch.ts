import type {
  BrowserBounds,
  BrowserElementContext,
  BrowserNetworkEntry,
  BrowserStateSnapshot,
  BrowserTabMetadata,
} from "./browser-types";
import type { BrowserTarget } from "./browser-interactions";
import {
  optionalNumber,
  optionalString,
  positiveInt,
  requiredNumber,
  requiredString,
} from "./browser-arg-validation";

export interface BrowserMcpTarget {
  state(scopeId?: number | null): BrowserStateSnapshot;
  openUrl(url: string, tabId?: string, scopeId?: number | null): Promise<BrowserTabMetadata>;
  openExternalUrl(
    url: string,
    tabId?: string,
    scopeId?: number | null,
  ): Promise<BrowserTabMetadata>;
  snapshot(tabId: string, selector?: string, maxLength?: number, format?: string): Promise<unknown>;
  screenshot(tabId: string, clip?: BrowserBounds): Promise<string>;
  screenshotTarget(tabId: string, target: BrowserTarget): Promise<string>;
  evaluate(tabId: string, script: string): Promise<unknown>;
  click(tabId: string, x: number, y: number): Promise<void>;
  clickTarget(tabId: string, target: BrowserTarget): Promise<unknown>;
  fill(tabId: string, target: BrowserTarget, value: string): Promise<void>;
  hover(tabId: string, target: BrowserTarget): Promise<unknown>;
  waitFor(
    tabId: string,
    opts: { selector?: string; text?: string },
    timeoutMs?: number,
  ): Promise<unknown>;
  typeText(tabId: string, text: string): Promise<void>;
  keypress(tabId: string, keyCode: string): Promise<void>;
  selectElementContext(tabId: string): Promise<BrowserElementContext | unknown>;
}

/** Result of a Browser MCP tool: a JSON text payload plus an optional viewable image. */
export interface BrowserBridgeResult {
  text: string;
  image?: { mimeType: string; data: string };
}

export async function dispatchBrowserMcpTool(
  target: BrowserMcpTarget,
  toolName: string,
  args: Record<string, unknown>,
  // Browser scope (the calling feature). New agent tabs are created in this
  // scope so they appear in the feature's Browser panel; active-tab resolution
  // and list/console/network views are scoped to it too. Undefined = scopeless.
  scopeId?: number | null,
): Promise<BrowserBridgeResult> {
  switch (toolName) {
    case "browser_list_tabs":
      return text(target.state(scopeId));
    case "browser_open_url":
      return text(
        await target.openUrl(requiredString(args.url, "url"), optionalString(args.tab_id), scopeId),
      );
    case "browser_open_external_url":
      return text(
        await target.openExternalUrl(
          requiredString(args.url, "url"),
          optionalString(args.tab_id),
          scopeId,
        ),
      );
    case "browser_get_console":
      return getConsole(target, args, scopeId);
    case "browser_get_network":
      return getNetwork(target, args, scopeId);
    case "browser_get_snapshot":
      return text(
        await target.snapshot(
          tabId(target, args, scopeId),
          optionalString(args.selector),
          maxLength(args),
          optionalString(args.format),
        ),
      );
    case "browser_screenshot":
      return screenshot(target, args, scopeId);
    case "browser_evaluate":
      return text(
        await target.evaluate(tabId(target, args, scopeId), requiredString(args.script, "script")),
      );
    case "browser_click":
      return click(target, args, scopeId);
    case "browser_fill":
      return fill(target, args, scopeId);
    case "browser_hover":
      return text(await target.hover(tabId(target, args, scopeId), parseTarget(args)));
    case "browser_wait_for":
      return waitFor(target, args, scopeId);
    case "browser_type":
      await target.typeText(tabId(target, args, scopeId), requiredString(args.text, "text"));
      return text({ ok: true });
    case "browser_keypress":
      await target.keypress(tabId(target, args, scopeId), requiredString(args.key, "key"));
      return text({ ok: true });
    case "browser_select_element_context":
      return text(await target.selectElementContext(tabId(target, args, scopeId)));
    default:
      throw new Error(`Unknown Browser MCP tool: ${toolName}`);
  }
}

async function screenshot(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): Promise<BrowserBridgeResult> {
  const id = tabId(target, args, scopeId);
  const selector = optionalString(args.selector);
  const ref = optionalString(args.ref);
  const region = clip(args.clip);
  const data =
    selector || ref
      ? await target.screenshotTarget(id, { selector, ref })
      : await target.screenshot(id, region);
  // A hidden/blank/not-yet-rendered tab composites to nothing, so capturePage
  // returns "". Never forward an empty image: an `input_image` with no data is a
  // malformed data URI that some agents (codex) reject on every later turn,
  // wedging the whole conversation. Fail with a useful hint instead.
  if (!data) {
    throw new Error(
      "Screenshot returned no image data — the tab is blank or not rendered yet. " +
        "Use browser_get_snapshot to inspect the page, or wait for it to load.",
    );
  }
  return {
    text: JSON.stringify({
      tabId: id,
      selector: selector ?? null,
      ref: ref ?? null,
      clip: region ?? null,
      format: "png",
    }),
    image: { mimeType: "image/png", data },
  };
}

async function click(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): Promise<BrowserBridgeResult> {
  const id = tabId(target, args, scopeId);
  if (args.selector !== undefined || args.ref !== undefined) {
    return text(await target.clickTarget(id, parseTarget(args)));
  }
  await target.click(id, requiredNumber(args.x, "x"), requiredNumber(args.y, "y"));
  return text({ ok: true });
}

async function fill(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): Promise<BrowserBridgeResult> {
  await target.fill(
    tabId(target, args, scopeId),
    parseTarget(args),
    requiredString(args.value, "value"),
  );
  return text({ ok: true });
}

async function waitFor(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): Promise<BrowserBridgeResult> {
  const opts = {
    selector: optionalString(args.selector),
    text: optionalString(args.text),
  };
  if (!opts.selector && !opts.text) throw new Error("Expected a selector or text to wait for.");
  return text(
    await target.waitFor(tabId(target, args, scopeId), opts, optionalNumber(args.timeout_ms)),
  );
}

function getConsole(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): BrowserBridgeResult {
  const level = optionalString(args.level);
  const entries = target.state(scopeId).consoleEntries;
  const filtered = level ? entries.filter((entry) => entry.level === level) : entries;
  return text(filtered.slice(-positiveInt(args.limit, 50)));
}

function getNetwork(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): BrowserBridgeResult {
  const urlContains = optionalString(args.url_contains);
  const includeHeaders = args.include_headers === true;
  let entries = target.state(scopeId).networkEntries;
  if (args.failed_only === true) {
    entries = entries.filter((entry) => entry.failureReason || (entry.status ?? 0) >= 400);
  }
  if (urlContains) entries = entries.filter((entry) => entry.url.includes(urlContains));
  return text(
    entries
      .slice(-positiveInt(args.limit, 50))
      .map((entry) => compactNetwork(entry, includeHeaders)),
  );
}

function compactNetwork(
  entry: BrowserNetworkEntry,
  includeHeaders: boolean,
): Record<string, unknown> {
  const compact: Record<string, unknown> = {
    method: entry.method,
    url: entry.url,
    status: entry.status,
    failureReason: entry.failureReason,
    resourceType: entry.resourceType,
    timestamp: entry.timestamp,
  };
  if (includeHeaders) {
    compact.requestHeaders = entry.requestHeaders;
    compact.responseHeaders = entry.responseHeaders;
  }
  return compact;
}

function parseTarget(args: Record<string, unknown>): BrowserTarget {
  const selector = optionalString(args.selector);
  const ref = optionalString(args.ref);
  if (!selector && !ref) throw new Error("Expected a selector or ref.");
  return { selector, ref };
}

function clip(value: unknown): BrowserBounds | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("Expected clip to be an object.");
  const record = value as Record<string, unknown>;
  return {
    x: requiredNumber(record.x, "clip.x"),
    y: requiredNumber(record.y, "clip.y"),
    width: requiredNumber(record.width, "clip.width"),
    height: requiredNumber(record.height, "clip.height"),
  };
}

function maxLength(args: Record<string, unknown>): number | undefined {
  const value = optionalNumber(args.max_length);
  return value !== undefined && value > 0 ? value : undefined;
}

function tabId(
  target: BrowserMcpTarget,
  args: Record<string, unknown>,
  scopeId?: number | null,
): string {
  const explicit = optionalString(args.tab_id);
  if (explicit) return explicit;
  const active = target.state(scopeId).activeTabId;
  if (!active) throw new Error("No active browser tab.");
  return active;
}

function text(value: unknown): BrowserBridgeResult {
  return { text: JSON.stringify(value) };
}
