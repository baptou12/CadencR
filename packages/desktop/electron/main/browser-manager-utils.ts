import { randomUUID } from "node:crypto";
import { browserAutomationAccess } from "./browser-policy";
import {
  browserPartitionForProfile,
  createBrowserProfile,
  type BrowserProfile,
} from "./browser-profiles";
import type {
  BrowserConsoleEntry,
  BrowserElementContext,
  BrowserNetworkEntry,
  BrowserTabMetadata,
} from "./browser-types";

const DEFAULT_URL = "about:blank";

export function assertBrowserMutationAllowed(liveUrl: string): void {
  if (browserAutomationAccess(liveUrl) !== "full") {
    throw new Error("Browser automation is allowed only for localhost tabs.");
  }
}

/**
 * Origin of any URL, or null when it can't be parsed (e.g. about:blank). Unlike
 * the origin-store's history helper this is intentionally scheme-agnostic — it
 * backs the external-automation check, which only ever compares http(s) origins.
 */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Whether a tab whose external automation was unlocked for `unlockedOrigin` may
 * still be mutated at `liveUrl`. The unlock is scoped to the approved origin, so
 * a tab that later navigates elsewhere (link click, redirect) re-locks itself.
 */
export function externalAutomationMatches(liveUrl: string, unlockedOrigin: string | null): boolean {
  return unlockedOrigin !== null && originOf(liveUrl) === unlockedOrigin;
}

export function tabDiagnostics(
  consoleEntries: BrowserConsoleEntry[],
  networkEntries: BrowserNetworkEntry[],
): BrowserElementContext["diagnostics"] {
  return {
    consoleErrors: consoleEntries.filter((entry) => entry.level === "error").slice(-20),
    failedNetworkRequests: networkEntries
      .filter((entry) => entry.failureReason || (entry.status ?? 0) >= 400)
      .slice(-20),
  };
}

export function secureWebPreferences(profile: BrowserProfile): Electron.WebPreferences {
  return {
    partition: browserPartitionForProfile(profile),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    plugins: false,
    devTools: true,
  };
}

export function metadataFor(
  id: string,
  profileId: string,
  scopeId: number | null,
): BrowserTabMetadata {
  return {
    id,
    title: "New tab",
    url: DEFAULT_URL,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    sessionProfileId: profileId,
    isActive: false,
    devToolsOpen: false,
    scopeId,
  };
}

export function profileFromSelection(profileId: string): BrowserProfile {
  if (profileId === "fresh") return createBrowserProfile("fresh");
  if (profileId === "feature") return createBrowserProfile("feature", "feature");
  return createBrowserProfile("persistent", profileId.replace(/^persistent:/, ""));
}

export function consoleEntry(
  tabId: string,
  level: number | string,
  message: string,
  lineNumber: number,
  sourceUrl: string,
): BrowserConsoleEntry {
  return {
    id: randomUUID(),
    tabId,
    level: consoleLevelName(level),
    message,
    sourceUrl,
    lineNumber,
    timestamp: new Date().toISOString(),
  };
}

// Electron 42 reports the level as a string ('debug' | 'info' | 'warning' |
// 'error'); older numeric levels (0–3) are still mapped for safety.
export function consoleLevelName(level: number | string): string {
  if (typeof level === "string") return level === "debug" ? "verbose" : level;
  return ["verbose", "info", "warning", "error"][level] ?? "info";
}

export function pushBounded<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Validates the object returned by an injected in-page script. Returns it typed
// when `isValid` passes, otherwise throws the page-supplied `error` (if any) or
// `fallbackMessage`.
export function expectScriptResult<T>(
  result: unknown,
  isValid: (record: Record<string, unknown>) => boolean,
  fallbackMessage: string,
): T {
  if (isRecord(result) && isValid(result)) return result as unknown as T;
  const reason = isRecord(result) && typeof result.error === "string" ? result.error : null;
  throw new Error(reason ?? fallbackMessage);
}

export function isElementPayload(value: unknown): value is BrowserElementContext["element"] {
  return (
    isRecord(value) &&
    Array.isArray(value.selectorCandidates) &&
    typeof value.tagName === "string" &&
    isRecord(value.attributes) &&
    isRecord(value.boundingBox) &&
    isRecord(value.computedStyles)
  );
}
