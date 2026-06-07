import { isSafeExternalUrl } from "@/lib/safe-url";

export interface RuntimeConfig {
  baseUrl: string;
  authToken: string | null;
}

export type RouteType = "session";
export type DesktopTheme = "light" | "dark";

export interface NotificationClickPayload {
  feature_id: number;
  project_id: number;
  route_type: RouteType;
}

export interface NotificationFallbackPayload {
  title: string;
  body: string;
  click: NotificationClickPayload | null;
}

/**
 * Where an agent-finished notification should be rendered. `"off"` is
 * resolved in the renderer (we just skip the bridge call entirely), so
 * the bridge only ever sees these two modes.
 */
export type NotifyMode = "native" | "in_app";

export interface NotifyBridgeOptions {
  title: string;
  body: string;
  featureId: number;
  projectId: number;
  routeType: RouteType;
  mode: NotifyMode;
}

export interface FileDropItem {
  handle: string;
  name: string;
}

export interface FileDropPayload {
  type: "enter" | "leave" | "drop" | "error";
  files: FileDropItem[];
  targetPromptId?: string;
  message?: string;
}

export type UpdateEvent =
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | {
      /** Markdown body for `version`, fetched from GitHub. `null` on miss/failure. */
      kind: "changelog";
      version: string;
      markdown: string | null;
    }
  | { kind: "not-available"; version: string }
  | { kind: "error"; message: string }
  | { kind: "download-progress"; percent: number; bytesPerSecond: number }
  | { kind: "downloaded"; version: string };

export interface CadencrDesktopBridge {
  isElectron: boolean;
  runtimeConfig: () => Promise<RuntimeConfig>;
  readFileBase64: (handle: string) => Promise<string>;
  onFileDrop: (cb: (payload: FileDropPayload) => void) => () => void;
  revealInFinder: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  pickDirectory: () => Promise<string | null>;
  /**
   * Prompt the user with the native "Save As" dialog. Resolves to the chosen
   * absolute path or `null` if the dialog was canceled.
   */
  showSaveDialog: (opts: { defaultPath: string; title?: string }) => Promise<string | null>;
  notifyPermission: () => Promise<boolean>;
  notify: (opts: NotifyBridgeOptions) => Promise<void>;
  notifyTest: () => Promise<void>;
  onNotificationClicked: (cb: (payload: NotificationClickPayload) => void) => () => void;
  onNotificationFailed: (cb: (payload: { reason: string }) => void) => () => void;
  onNotificationFallback: (cb: (payload: NotificationFallbackPayload) => void) => () => void;
  onCloseRequested: (cb: () => void) => () => void;
  confirmClose: () => Promise<void>;
  requestQuit: () => Promise<void>;
  setZoom: (factor: number) => Promise<void>;
  currentTheme: () => Promise<DesktopTheme>;
  onThemeChange: (cb: (appearance: DesktopTheme) => void) => () => void;
  /**
   * Tell the main process whether any agent turn is currently active. Main
   * uses this to ref-count `powerSaveBlocker('prevent-app-suspension')` so
   * the OS keeps the system awake while agents stream and lets it sleep
   * normally when they don't (per `feature-sleep-aware-agent-reliability`).
   */
  setBusy: (busy: boolean) => Promise<void>;
  /**
   * Request (or release) a macOS-friendly idle-system-sleep block for remote
   * hosting. Held independently of `setBusy` so neither caller releases the
   * other's assertion. Uses `prevent-app-suspension`, so the display may still
   * sleep/lock; only idle system sleep is blocked. No-op off macOS / in a
   * browser. See `feature/macos-remote-ux-sleep-prevention`.
   */
  setRemoteHostAwake: (enabled: boolean) => Promise<void>;
  /** Fired just before the OS suspends. Cleanup is up to the renderer. */
  onPowerSuspend: (cb: () => void) => () => void;
  /** Fired right after wake-from-suspend. */
  onPowerResume: (cb: () => void) => () => void;
  /** Ask the main process to check for an update right now. */
  checkForUpdates: () => Promise<void>;
  /** Quit and install a downloaded update. */
  installUpdate: () => Promise<void>;
  /**
   * Fetch the markdown release notes for a given version from GitHub.
   * Returns `null` when the release isn't published or the request fails.
   */
  fetchChangelog: (version: string) => Promise<string | null>;
  /** Subscribe to all auto-updater lifecycle events. */
  onUpdateEvent: (cb: (event: UpdateEvent) => void) => () => void;
}

declare global {
  interface Window {
    cadencr?: CadencrDesktopBridge;
  }
}

let bridgeOverride: CadencrDesktopBridge | null = null;

function browserTheme(): DesktopTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function unavailable(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} is only available in the desktop shell.`));
}

const browserBridge: CadencrDesktopBridge = {
  isElectron: false,
  runtimeConfig: () => unavailable("runtimeConfig"),
  readFileBase64: () => unavailable("readFileBase64"),
  onFileDrop: () => () => undefined,
  revealInFinder: () => unavailable("revealInFinder"),
  // Opening a URL has a universal browser equivalent (keeps "view compare URL",
  // changelog links, etc. working in a remote tab), but it must enforce the same
  // policy the Electron shell does — reject anything that isn't a credential-free
  // https URL to a non-loopback host — so callers' error handling stays uniform.
  openExternal: (url: string) => {
    if (typeof window === "undefined") return Promise.resolve();
    if (!isSafeExternalUrl(url)) {
      return Promise.reject(
        new Error("Only https:// URLs without credentials or loopback hosts can be opened."),
      );
    }
    window.open(url, "_blank", "noopener,noreferrer");
    return Promise.resolve();
  },
  pickDirectory: () => unavailable("pickDirectory"),
  showSaveDialog: () => unavailable("showSaveDialog"),
  notifyPermission: () => Promise.resolve(false),
  notify: () => Promise.resolve(),
  notifyTest: () => unavailable("notifyTest"),
  onNotificationClicked: () => () => undefined,
  onNotificationFailed: () => () => undefined,
  onNotificationFallback: () => () => undefined,
  onCloseRequested: () => () => undefined,
  confirmClose: () => Promise.resolve(),
  requestQuit: () => Promise.resolve(),
  setZoom: () => Promise.resolve(),
  currentTheme: () => Promise.resolve(browserTheme()),
  onThemeChange: () => () => undefined,
  setBusy: () => Promise.resolve(),
  setRemoteHostAwake: () => Promise.resolve(),
  onPowerSuspend: () => () => undefined,
  onPowerResume: () => () => undefined,
  checkForUpdates: () => unavailable("checkForUpdates"),
  installUpdate: () => unavailable("installUpdate"),
  fetchChangelog: () => Promise.resolve(null),
  onUpdateEvent: () => () => undefined,
};

function activeBridge(): CadencrDesktopBridge {
  if (bridgeOverride) return bridgeOverride;
  if (typeof window !== "undefined" && window.cadencr) return window.cadencr;
  return browserBridge;
}

export const desktopBridge: CadencrDesktopBridge = new Proxy({} as CadencrDesktopBridge, {
  get(_target: CadencrDesktopBridge, prop: string | symbol): unknown {
    const bridge = activeBridge();
    const value = bridge[prop as keyof CadencrDesktopBridge];
    return typeof value === "function" ? value.bind(bridge) : value;
  },
});

/**
 * True when running inside the Electron desktop shell (preload bridge present).
 * Use to gate native-only affordances — folder pickers, "reveal in Finder",
 * save dialogs, native notifications — that have no browser equivalent, so a
 * remote-browser session doesn't surface buttons that can only reject.
 */
export function isDesktopShell(): boolean {
  return desktopBridge.isElectron;
}

export function setDesktopBridgeOverrideForTests(bridge: CadencrDesktopBridge): void {
  bridgeOverride = bridge;
}

export function clearDesktopBridgeOverrideForTests(): void {
  bridgeOverride = null;
}
