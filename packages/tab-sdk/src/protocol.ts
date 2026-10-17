/**
 * Wire protocol between a custom-tab guest and the Cadencr host broker
 * (docs/CUSTOM_TABS.md §7).
 *
 * This module is the shared contract: the SDK speaks it from the guest side and
 * the renderer broker imports the same types for the host side. It must stay
 * dependency-free and side-effect-free.
 */

/** The `v` field every message carries. */
export const PROTOCOL_VERSION = 1 as const;

/** The plugin API version this SDK build targets. */
export const API_VERSION = 1 as const;

/** `[min, max]` plugin API versions, inclusive. */
export type ApiVersionRange = readonly [min: number, max: number];

/** API versions this SDK can speak, inclusive. */
export const SUPPORTED_API_VERSIONS: ApiVersionRange = [1, 1];

/** `data.type` of the window message the guest preload posts with the port. */
export const PORT_MESSAGE_TYPE = "cadencr-tab:port" as const;

export const ERROR_CODES = [
  "PLUGIN_API_UNSUPPORTED",
  "CAPABILITY_DENIED",
  "PLUGIN_SCOPE_DENIED",
  "PLUGIN_BINDING_DENIED",
  "PLUGIN_NETWORK_DENIED",
  "NOT_FOUND",
  "BAD_REQUEST",
  "TIMEOUT",
  "DISCONNECTED",
  "HOST_ERROR",
] as const;

/** Error codes defined by the protocol. Service errors relayed through
 *  `api.*` helpers may carry any other stable service code. */
export type CadencrErrorCode = (typeof ERROR_CODES)[number];

export interface WireError {
  code: string;
  message: string;
  details?: unknown;
}

// ─── Envelopes ───────────────────────────────────────────────────────────────

export interface GuestToHost {
  v: 1;
  kind: "request";
  id: string;
  method: string;
  params?: unknown;
}

export interface HostResponseOk {
  v: 1;
  kind: "response";
  id: string;
  result: unknown;
}

export interface HostResponseError {
  v: 1;
  kind: "response";
  id: string;
  error: WireError;
}

export interface HostEventMessage {
  v: 1;
  kind: "event";
  event: string;
  payload: unknown;
}

export type HostToGuest = HostResponseOk | HostResponseError | HostEventMessage;

// ─── Shared shapes ───────────────────────────────────────────────────────────

export interface TabContext {
  project: { id: number; name: string; path: string };
  feature: {
    id: number;
    name: string;
    branch: string | null;
    baseBranch: string | null;
    worktreePath: string | null;
  };
  pullRequest: { number: number; url: string; state: string; title: string | null } | null;
  session: { id: number | null; provider: string | null; status: string | null } | null;
}

export type ThemeAppearance = "light" | "dark";

export interface ThemeSnapshot {
  id: string;
  appearance: ThemeAppearance;
  /** `"background"` → `"#0f1115"` — token names carry no leading `--`. */
  tokens: Record<string, string>;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Response shape shared by `api.request` and `net.fetch`. */
export interface WireHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer | null;
}

/** Internal event forwarded unchanged from the service socket. */
export interface StreamEnvelope {
  domain: string;
  action: string;
  payload: unknown;
}

/** Topics of the plugin socket (docs/CUSTOM_TABS.md §4.4). */
export type StreamTopic =
  | "git.status"
  | "session.stream"
  | "files.changes"
  | "forge.status"
  | "feature.events"
  | "session.status";

export type ToastVariant = "default" | "success" | "error";

/** Values `storage.*` and `state.*` accept: anything structured-clone and
 *  JSON-serializable. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ─── Methods ─────────────────────────────────────────────────────────────────

export interface HelloParams {
  sdkVersion: string;
  apiVersions: ApiVersionRange;
}

export interface HelloResult {
  apiVersion: number;
  instanceId: string;
  plugin: { id: string; version: string };
  context: TabContext;
  theme: ThemeSnapshot;
  capabilities: string[];
  /** Whether the tab is shown right now; later changes arrive as `visibility.changed`. */
  visible: boolean;
}

export interface ApiRequestParams {
  method: HttpMethod;
  /** Service path, e.g. `/api/features/12`. */
  path: string;
  query?: Record<string, string>;
  /** JSON text; sent with `content-type: application/json`. */
  body?: string;
}

export interface NetFetchParams {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer;
}

export interface NetFetchResult {
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface ToastParams {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

type NoParams = Record<string, never>;

/** Every request method with its params and result. */
export interface MethodMap {
  hello: { params: HelloParams; result: HelloResult };
  "api.request": { params: ApiRequestParams; result: WireHttpResponse };
  "streams.subscribe": {
    params: { topic: string; params?: Record<string, unknown> };
    result: { subscriptionId: string };
  };
  "streams.unsubscribe": { params: { subscriptionId: string }; result: null };
  /** Resolves `null` for a missing key. */
  "storage.get": { params: { key: string }; result: JsonValue };
  "storage.set": { params: { key: string; value: JsonValue }; result: null };
  "storage.delete": { params: { key: string }; result: null };
  /** Resolves the stored keys. */
  "storage.list": { params: NoParams; result: string[] };
  /** Resolves `null` when nothing was stored for this instance. */
  "state.get": { params: NoParams; result: JsonValue };
  "state.set": { params: { value: JsonValue }; result: null };
  "config.get": { params: NoParams; result: Record<string, unknown> };
  "net.fetch": { params: NetFetchParams; result: NetFetchResult };
  "ui.toast": { params: ToastParams; result: null };
  "ui.openExternal": { params: { url: string }; result: null };
  "ui.setBadge": { params: { text: string | null }; result: null };
}

export type MethodName = keyof MethodMap;
export type MethodParams<M extends MethodName> = MethodMap[M]["params"];
export type MethodResult<M extends MethodName> = MethodMap[M]["result"];

export const METHOD_NAMES = [
  "hello",
  "api.request",
  "streams.subscribe",
  "streams.unsubscribe",
  "storage.get",
  "storage.set",
  "storage.delete",
  "storage.list",
  "state.get",
  "state.set",
  "config.get",
  "net.fetch",
  "ui.toast",
  "ui.openExternal",
  "ui.setBadge",
] as const satisfies readonly MethodName[];

/** A request narrowed to one method. */
export type TypedRequest = {
  [M in MethodName]: { v: 1; kind: "request"; id: string; method: M; params: MethodParams<M> };
}[MethodName];

// ─── Events ──────────────────────────────────────────────────────────────────

export interface EventMap {
  "context.changed": { context: TabContext };
  "theme.changed": { theme: ThemeSnapshot };
  "visibility.changed": { visible: boolean };
  "stream.event": { subscriptionId: string; seq: number; data: StreamEnvelope };
  /** The plugin should refetch: events were lost. */
  "stream.resync": { subscriptionId: string };
  "stream.error": { subscriptionId: string; error: WireError };
}

export type EventName = keyof EventMap;

export const EVENT_NAMES = [
  "context.changed",
  "theme.changed",
  "visibility.changed",
  "stream.event",
  "stream.resync",
  "stream.error",
] as const satisfies readonly EventName[];

/** An event narrowed to one name. */
export type TypedEvent = {
  [E in EventName]: { v: 1; kind: "event"; event: E; payload: EventMap[E] };
}[EventName];

// ─── Helpers (usable by either side) ─────────────────────────────────────────

/** The highest version both ranges include, or `null` when they are disjoint. */
export function negotiateApiVersion(
  guest: ApiVersionRange,
  host: ApiVersionRange = SUPPORTED_API_VERSIONS,
): number | null {
  const high = Math.min(guest[1], host[1]);
  const low = Math.max(guest[0], host[0]);
  return high >= low ? high : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isGuestToHost(value: unknown): value is GuestToHost {
  return (
    isRecord(value) &&
    value.v === PROTOCOL_VERSION &&
    value.kind === "request" &&
    typeof value.id === "string" &&
    typeof value.method === "string"
  );
}

export function isHostToGuest(value: unknown): value is HostToGuest {
  if (!isRecord(value) || value.v !== PROTOCOL_VERSION) return false;
  if (value.kind === "event") return typeof value.event === "string";
  if (value.kind !== "response" || typeof value.id !== "string") return false;
  return "result" in value || isRecord(value.error);
}

export function isMethodName(value: string): value is MethodName {
  return (METHOD_NAMES as readonly string[]).includes(value);
}
