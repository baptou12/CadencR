import type {
  BrowserElementContext,
  BrowserStateSnapshot,
  BrowserTabMetadata,
} from "./browser-types";
import { optionalString, requiredNumber, requiredString } from "./browser-arg-validation";

export interface BrowserMcpTarget {
  state(): BrowserStateSnapshot;
  createTab(rawUrl?: string, profileId?: string): BrowserTabMetadata;
  navigate(tabId: string, rawUrl: string): BrowserTabMetadata;
  snapshot(tabId: string): Promise<unknown>;
  screenshot(tabId: string): Promise<string>;
  click(tabId: string, x: number, y: number): Promise<void>;
  typeText(tabId: string, text: string): Promise<void>;
  keypress(tabId: string, keyCode: string): Promise<void>;
  selectElementContext(tabId: string): Promise<BrowserElementContext | unknown>;
}

export async function dispatchBrowserMcpTool(
  target: BrowserMcpTarget,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "browser_list_tabs":
      return stringify(target.state());
    case "browser_open_url":
      return stringify(openUrl(target, args));
    case "browser_get_console":
      return stringify(target.state().consoleEntries);
    case "browser_get_network":
      return stringify(target.state().networkEntries);
    case "browser_get_snapshot":
      return stringify(await target.snapshot(tabId(target, args)));
    case "browser_screenshot":
      return stringify({ pngBase64: await target.screenshot(tabId(target, args)) });
    case "browser_click":
      {
        const x = requiredNumber(args.x, "x");
        const y = requiredNumber(args.y, "y");
        await target.click(tabId(target, args), x, y);
      }
      return stringify({ ok: true });
    case "browser_type": {
      const text = requiredString(args.text, "text");
      await target.typeText(tabId(target, args), text);
      return stringify({ ok: true });
    }
    case "browser_keypress": {
      const key = requiredString(args.key, "key");
      await target.keypress(tabId(target, args), key);
      return stringify({ ok: true });
    }
    case "browser_select_element_context":
      return stringify(await target.selectElementContext(tabId(target, args)));
    default:
      throw new Error(`Unknown Browser MCP tool: ${toolName}`);
  }
}

function openUrl(target: BrowserMcpTarget, args: Record<string, unknown>): BrowserTabMetadata {
  const url = requiredString(args.url, "url");
  const explicitTabId = optionalString(args.tab_id);
  return explicitTabId ? target.navigate(explicitTabId, url) : target.createTab(url);
}

function tabId(target: BrowserMcpTarget, args: Record<string, unknown>): string {
  const explicit = optionalString(args.tab_id);
  if (explicit) return explicit;
  const active = target.state().activeTabId;
  if (!active) throw new Error("No active browser tab.");
  return active;
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}
