import { EyeOff, Globe, type LucideIcon } from "lucide-react";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";

/** Workspace setting holding the browser tab's default cookie mode. */
export const BROWSER_DEFAULT_MODE_SETTING_KEY = "browser_default_mode";

/** Workspace setting toggling whether agents get the `cadencr-browser` MCP. */
export const BROWSER_MCP_ENABLED_SETTING_KEY = "browser_mcp_enabled";

/** Two cookie modes the user can pick. Normal reuses an on-disk profile; private is in-memory only. */
export type CookieMode = "normal" | "private";

/** Profile id passed to the backend for each mode. "default" → persistent partition, "fresh" → ephemeral. */
export const PROFILE_ID: Record<CookieMode, string> = { normal: "default", private: "fresh" };

export const DEFAULT_COOKIE_MODE: CookieMode = "normal";

export function parseCookieMode(value: string | null | undefined): CookieMode {
  return value === "private" ? "private" : DEFAULT_COOKIE_MODE;
}

export interface BrowserModeOption {
  value: CookieMode;
  label: string;
  description: string;
  icon: LucideIcon;
  /** CSS variable for the icon's accent color. */
  iconColorVar: string;
}

export const BROWSER_MODE_OPTIONS: readonly BrowserModeOption[] = [
  {
    value: "normal",
    label: "Normal",
    description:
      "Reuses a persistent profile. Cookies and logins are kept on disk and shared between sessions.",
    icon: Globe,
    iconColorVar: "var(--acc-blue)",
  },
  {
    value: "private",
    label: "Private",
    description:
      "Ephemeral in-memory session. Cookies and storage are discarded when the tab closes.",
    icon: EyeOff,
    iconColorVar: "var(--muted-foreground)",
  },
] as const;

export interface UseBrowserDefaultModeResult {
  mode: CookieMode;
  isLoading: boolean;
}

/** Read-only view of the user's default browser mode (Settings → Browser). */
export function useBrowserDefaultMode(): UseBrowserDefaultModeResult {
  const setting = useDebouncedSetting(BROWSER_DEFAULT_MODE_SETTING_KEY, 0);
  return { mode: parseCookieMode(setting.value), isLoading: setting.isLoading };
}

export interface UseBrowserMcpEnabledResult {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  isLoading: boolean;
}

/** Toggle for exposing the `cadencr-browser` MCP to agents. Defaults to enabled. */
export function useBrowserMcpEnabled(): UseBrowserMcpEnabledResult {
  const setting = useDebouncedSetting(BROWSER_MCP_ENABLED_SETTING_KEY, 0);
  return {
    enabled: setting.value !== "false",
    setEnabled: (next: boolean) => setting.setValue(next ? "true" : "false"),
    isLoading: setting.isLoading,
  };
}
