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
  BrowserTabMetadata,
} from "./browser-types";

const DEFAULT_URL = "about:blank";

export function assertBrowserMutationAllowed(liveUrl: string): void {
  if (browserAutomationAccess(liveUrl) !== "full") {
    throw new Error("Browser automation is allowed only for localhost tabs.");
  }
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

export function metadataFor(id: string, profileId: string): BrowserTabMetadata {
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
  };
}

export function profileFromSelection(profileId: string): BrowserProfile {
  if (profileId === "fresh") return createBrowserProfile("fresh");
  if (profileId === "feature") return createBrowserProfile("feature", "feature");
  return createBrowserProfile("persistent", profileId.replace(/^persistent:/, ""));
}

export function consoleEntry(
  tabId: string,
  level: number,
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

export function consoleLevelName(level: number): string {
  return ["verbose", "info", "warning", "error"][level] ?? "info";
}

export function pushBounded<T>(items: T[], item: T, limit: number): void {
  items.push(item);
  if (items.length > limit) items.splice(0, items.length - limit);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
