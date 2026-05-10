export interface RuntimeConfig {
  baseUrl: string;
  authToken: string | null;
}

export type RouteType = "workflow" | "session";
export type DesktopTheme = "light" | "dark";

export interface NotificationClickPayload {
  feature_id: number;
  project_id: number;
  route_type: RouteType;
}

export interface NotifyBridgeOptions {
  title: string;
  body: string;
  featureId: number;
  projectId: number;
  routeType: RouteType;
}

export interface FileDropItem {
  handle: string;
  name: string;
}

export interface FileDropPayload {
  type: "enter" | "leave" | "drop" | "error";
  files: FileDropItem[];
  message?: string;
}

export interface CadencrDesktopBridge {
  isElectron: boolean;
  runtimeConfig: () => Promise<RuntimeConfig>;
  readFileBase64: (handle: string) => Promise<string>;
  onFileDrop: (cb: (payload: FileDropPayload) => void) => () => void;
  revealInFinder: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  pickDirectory: () => Promise<string | null>;
  notifyPermission: () => Promise<boolean>;
  notify: (opts: NotifyBridgeOptions) => Promise<void>;
  notifyTest: () => Promise<void>;
  onNotificationClicked: (cb: (payload: NotificationClickPayload) => void) => () => void;
  onNotificationFailed: (cb: (payload: { reason: string }) => void) => () => void;
  onCloseRequested: (cb: () => void) => () => void;
  confirmClose: () => Promise<void>;
  requestQuit: () => Promise<void>;
  setZoom: (factor: number) => Promise<void>;
  currentTheme: () => Promise<DesktopTheme>;
  onThemeChange: (cb: (appearance: DesktopTheme) => void) => () => void;
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
  openExternal: () => unavailable("openExternal"),
  pickDirectory: () => unavailable("pickDirectory"),
  notifyPermission: () => Promise.resolve(false),
  notify: () => Promise.resolve(),
  notifyTest: () => unavailable("notifyTest"),
  onNotificationClicked: () => () => undefined,
  onNotificationFailed: () => () => undefined,
  onCloseRequested: () => () => undefined,
  confirmClose: () => Promise.resolve(),
  requestQuit: () => Promise.resolve(),
  setZoom: () => Promise.resolve(),
  currentTheme: () => Promise.resolve(browserTheme()),
  onThemeChange: () => () => undefined,
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

export function setDesktopBridgeOverrideForTests(bridge: CadencrDesktopBridge): void {
  bridgeOverride = bridge;
}

export function clearDesktopBridgeOverrideForTests(): void {
  bridgeOverride = null;
}
