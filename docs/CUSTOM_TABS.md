# Custom tabs

Status: implemented locally (decision 2026-10-16, amends
[PLUGIN_STRATEGY.md §4/§5](./PLUGIN_STRATEGY.md)). Custom tabs are **local
plugins**: a user builds a web UI that Cadencr shows as a feature-page tab, next
to Agent, Terminal, Git, Editor and Browser. They are flagged as plugin projects
(`authoring_target = 'tab'`) so a later marketplace can publish them; no
marketplace UI ships with them.

This document is the contract shared by the service, the Electron host, the
renderer broker, `@cadencr/tab-sdk` and `@cadencr/tab-kit`. Change it first,
then the code.

## 1. Model

| Term | Meaning |
| --- | --- |
| **Custom tab** | A local plugin of kind `tab`: a folder holding `tab.json` and a static `dist/` bundle. |
| **Tab instance** | One live rendering of a custom tab inside one feature page. Identified by an opaque `instanceId`. |
| **Grant** | An ephemeral, in-memory, opaque token the service mints for one instance. It names the plugin, project, feature and the consented scopes. Never shown to the guest. |
| **Guest** | The plugin's web page, running in an isolated `WebContentsView`. |
| **Broker** | First-party renderer code that owns the guest's `MessagePort`, holds the grant, and relays requests. |

Invariants:

1. No third-party JavaScript ever runs in the Cadencr renderer. Guests run in
   their own process, partition and origin.
2. The guest has no network (`connect-src 'none'`). Every byte it gets comes
   through its `MessagePort`.
3. Authorization is enforced by the **service** from the grant. Context the host
   hands the guest is information, not authority.
4. Deny by default: an API route is reachable by a plugin only when the policy
   table lists it.
5. Desktop only in v1. The remote/mobile SPA shows a placeholder.

## 2. Package layout on disk

```
~/.cadencr/plugins/tabs/<id>/      # a Git repository (authoring project)
  tab.json                         # manifest (§3)
  icon.svg                         # optional, ≤ 32 KiB
  package.json, src/, vite.config.ts, …
  dist/                            # build output Cadencr loads (gitignored)
    index.html                     # `entry`
```

The root is `settings_store::dir::sibling_dir("plugins").join("tabs")`, the
sibling of `plugins/themes`. Cadencr rescans it on startup and watches it
(`tab.json`, `icon.svg`, `dist/**`).

## 3. Manifest — `tab.json`

```json
{
  "schema_version": 1,
  "kind": "tab",
  "id": "changed-files-graph",
  "name": "Changed files graph",
  "version": "0.1.0",
  "description": "Graph of the files this feature changed.",
  "icon": "icon.svg",
  "api_version": 1,
  "entry": "dist/index.html",
  "tab": { "label": "Graph" },
  "permissions": ["features:read", "git:read"],
  "network": {
    "allowed_origins": ["https://gitlab.example.com"],
    "reasoning": "Reads merge-request pipelines from the team GitLab."
  },
  "configuration": [
    { "key": "gitlab_url", "type": "string", "label": "GitLab URL", "scope": "global" },
    { "key": "gitlab_token", "type": "secret", "label": "Access token", "scope": "global" },
    { "key": "group", "type": "select", "label": "Grouping", "scope": "project",
      "options": ["directory", "extension"], "default": "directory" }
  ]
}
```

Rules (validated by `cadencr-plugin-core::tab`, the service and
`cadencr plugin validate --kind tab`):

- `id`: `^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$` and equal to the folder name.
  It is a URL host label (`cadencr-tab://<id>/`).
- `name` 1–64 chars, `version` semver, `description` ≤ 280 chars, `tab.label`
  1–24 chars (defaults to `name`).
- `api_version`: integer; v1 hosts accept `1`.
- `entry`, `icon`: relative, normalized, no `..`, no absolute paths, no
  backslashes; `icon` must end in `.svg`.
- `permissions`: unique values from the scope list in §6. Unknown scopes are
  errors.
- `network.allowed_origins`: `https://host[:port]` origins (`http://` allowed
  only for `localhost`/`127.0.0.1`), no paths, no wildcards, ≤ 16 entries.
  `reasoning` is required when the list is non-empty.
- `configuration`: ≤ 32 fields; `key` `^[a-z][a-z0-9_]{0,47}$`, unique; `type`
  ∈ `string | number | boolean | select | secret`; `scope` ∈ `global | project`;
  `select` requires non-empty `options`; `secret` cannot have a `default`.
- Unknown top-level keys are errors (the format is closed until it is published).

**Permissions hash**: SHA-256 (hex) over the canonical JSON
`{"permissions":[sorted],"allowed_origins":[sorted]}`. Consent is recorded
against this hash; a widened manifest requires a new consent.

## 4. Service

### 4.1 Tables (one migration)

- `projects.authoring_target` CHECK widens to `('theme','provider','tab')`
  (table rebuild — see the `migration-safety` skill).
- `plugin_tab_enablements(plugin_id TEXT, project_id INTEGER NULL REFERENCES
  projects(id) ON DELETE CASCADE, enabled INTEGER NOT NULL, updated_at TEXT)`.
  `project_id IS NULL` is the global row. Unique per `(plugin_id)` for global and
  per `(plugin_id, project_id)` for project rows.
- `plugin_tab_consents(plugin_id TEXT PRIMARY KEY, permissions_hash TEXT NOT
  NULL, consented_at TEXT NOT NULL)`.
- `plugin_tab_config(plugin_id, project_id NULL, key, value TEXT, updated_at)`
  — global and project values; secrets live here too and are never returned.
- `plugin_tab_storage(plugin_id, project_id INTEGER NOT NULL, key, value TEXT,
  updated_at)` — the plugin's own key/value store, per project.

Effective enablement for a project = project row ?? global row ?? off, **and**
a consent row whose hash equals the current permissions hash, **and** a valid
manifest.

### 4.2 Host API (main token, `x-cadencr-token`)

| Method & path | Purpose |
| --- | --- |
| `GET /api/plugin-tabs?project_id=` | List local tabs with manifest, validation, enablement. |
| `GET /api/plugin-tabs/{id}?project_id=` | One tab. |
| `PUT /api/plugin-tabs/{id}/enablement` | `{project_id: number\|null, enabled: boolean\|null}`; `null` clears a project override. Enabling needs consent. |
| `PUT /api/plugin-tabs/{id}/consent` | `{permissions_hash}`; must equal the current hash (409 `PLUGIN_TAB_CONSENT_STALE`). |
| `GET/PUT /api/plugin-tabs/{id}/configuration?project_id=` | Settings form values; secrets come back as `{ "is_set": true }`. |
| `GET /api/plugin-tabs/{id}/assets/{*path}` | Static bytes from the plugin folder with CSP headers (§5.2). Empty path = `entry`. |
| `POST /api/plugin-tabs/{id}/grants` | `{feature_id}` → `{token, expires_at, scopes, api_version}`. 403 `PLUGIN_TAB_DISABLED` if not effective for the feature's project. |
| `POST /api/plugin-tabs/authoring` | `{name, description?}` → `{plugin_id, project_id, feature_id, dir}`. Creates the authoring project (§8). |

Summary shape (`PluginTabSummary`): `id, name, version, description, label,
icon_svg (string|null), api_version, entry, entry_present, permissions,
network {allowed_origins, reasoning}, configuration, permissions_hash, status
("valid"|"invalid"), errors[], warnings[], dir, authoring_project_id|null,
enablement {global: bool|null, project: bool|null, effective: bool,
consent_required: bool}`.

### 4.3 Plugin API (grant token, `x-cadencr-plugin-token`)

`auth_middleware` accepts **either** the main token **or** a plugin token,
never both. With a plugin token it:

1. resolves the grant (unknown/expired → 401 `PLUGIN_TOKEN_INVALID`);
2. looks up `(method, MatchedPath)` in the policy table (missing → 403
   `PLUGIN_SCOPE_DENIED`);
3. checks the entry's scope is granted (403 `PLUGIN_SCOPE_DENIED`);
4. checks the binding: `FeaturePath(param)` / `FeatureQuery(param)` must equal
   the grant's feature, `ProjectPath`/`ProjectQuery` its project, `Unbound`
   requires nothing more (403 `PLUGIN_BINDING_DENIED`);
5. inserts a `PluginPrincipal` request extension.

Plugin-only routes (`binding = SelfPlugin`, no scope required):

| Method & path | Purpose |
| --- | --- |
| `GET /api/plugin-tabs/self/configuration` | Non-secret config, project values over global over defaults. |
| `GET /api/plugin-tabs/self/storage` | List keys. |
| `GET/PUT/DELETE /api/plugin-tabs/self/storage/{key}` | Own key/value store (value ≤ 256 KiB, ≤ 500 keys). |
| `POST /api/plugin-tabs/self/net/fetch` | Egress relay (§4.5). |
| `GET /api/plugin-tabs/ws` | Plugin socket (§4.4); token in subprotocol `cadencr-plugin.<token>`. |

The policy table (`domain/plugin_tabs/policy.rs`) is one ordered list of
`{method, path, scope, binding, tier}`. It drives enforcement, the filtered
OpenAPI document (`dump-openapi --plugin-surface`, operations tagged with
`x-cadencr-scope` and `x-cadencr-tier`) and the SDK's generated client.
`tier` is `stable` or `proposed`; local plugins may use both, a future
marketplace accepts only `stable`.

Never reachable with a plugin token: auth/remote pairing, installers and
provider lifecycle, MCP control, database maintenance, settings other than the
plugin's own, plugin enablement/consent/grants/authoring themselves.

### 4.4 Plugin socket

`GET /api/plugin-tabs/ws`, same `WsEnvelope` as `/ws`. Client actions, domain
`plugin`:

- `subscribe {topic, params?}` → reply `subscribed {subscription_id}` or an
  `error {code, message}` reply.
- `unsubscribe {subscription_id}`.

Server events: `{domain:"plugin", action:"event", payload:{subscription_id,
topic, seq, envelope:{domain, action, payload}}}` — `seq` is per subscription,
starting at 1; `envelope` is the internal event, forwarded unchanged.

| Topic | Scope | Source | Binding |
| --- | --- | --- | --- |
| `git.status` | `git:read` | `git_watcher` (`git/status`) | grant feature |
| `session.stream` | `agent:observe` | feature sender registry (session domain, read-only) | grant feature |
| `files.changes` | `files:read` | file watcher | grant feature |
| `forge.status` | `forge:read` | forge status | grant feature / project |
| `feature.events` | `features:read` | feature events | filtered to the grant project |
| `session.status` | `workspace:read` | app session status | none |

A plugin socket never accepts session-control actions (prompt, permission,
interrupt…). Outbound envelopes not matching a live subscription are dropped.

### 4.5 Egress relay

`POST /api/plugin-tabs/self/net/fetch` `{url, method, headers?, body_base64?}` →
`{status, headers, body_base64}`. The URL's origin must be in
`network.allowed_origins` (403 `PLUGIN_NETWORK_DENIED`). Redirects are followed
only within allowed origins (max 5). Timeout 30 s, response ≤ 10 MiB.
`{{secret:<key>}}` placeholders in header values are replaced server-side with
the plugin's secret config values; unknown secrets are a 400. Hop-by-hop and
`cookie` headers are stripped from both directions.

## 5. Electron host

### 5.1 Guest views

- Scheme `cadencr-tab` registered privileged (`standard`, `secure`,
  `supportFetchAPI`, `stream`) before `app.ready`.
- One `WebContentsView` per instance, partition `persist:cadencr-tab:<id>`,
  `sandbox`, `contextIsolation`, no Node, `webSecurity`, no `webviewTag`, a
  minimal preload (`electron/preload/plugin-tab.ts`) that only forwards the
  port.
- The partition's `protocol.handle('cadencr-tab')` serves only
  `cadencr-tab://<own id>/…` by relaying to `GET /api/plugin-tabs/{id}/assets/…`.
- Denied: permission requests and checks, `window.open`, navigation away from
  `cadencr-tab://<id>/`, any non-`cadencr-tab:`/`devtools:` request
  (`webRequest`), downloads, WebRTC non-proxied UDP.
- `setBackgroundColor(theme background)`; theme CSS injected with `insertCSS`
  before first paint and replaced on change.
- Bounds come from a renderer placeholder element (same math as the browser
  tab: zoomed CSS px → DIP). Views are hidden while a React overlay suppresses
  native views (`useSuppressBrowserView`).
- At most 6 live guests; the least recently shown hidden guest is destroyed and
  recreated on demand. `state` (§7) survives recreation.
- A crashed guest shows a placeholder with **Reload**; only `reload` recreates
  it. An entry document answering HTTP ≥ 400 is reported as `load-failed` and
  never receives a port.
- Instance ids match `^[A-Za-z0-9_.:-]{1,200}$`. The renderer bridge is
  `desktopBridge.pluginTabs` (`open`, `setBounds`, `setVisible`, `reload`,
  `close`, `openDevTools`, `focus`, `setTheme`, `onEvent`); shared types live in
  `packages/desktop/src/shared/plugin-tab-host.ts`.
- Pane chords (⌘⇧A/T/G/E/B) pressed in a focused guest are relayed to the
  renderer; other renderer shortcuts are not.

### 5.2 Asset responses

The entry is requested as `GET /api/plugin-tabs/{id}/assets/` (empty path).
The Electron relay re-applies the CSP and `nosniff` if a response lacks them;
a CSP header on a `protocol.handle` response is enforced by Electron 42 (verified
2026-10-17). The service sets `Content-Type`, `X-Content-Type-Options: nosniff`, and

```
Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
  connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none';
  form-action 'none'
```

Paths resolve under the plugin folder with realpath containment; dot-files and
`node_modules` are never served.

### 5.3 Port bootstrap

On every guest load the main process creates a `MessageChannelMain`, sends one
end to the guest (`cadencr-tab:port`) and the other to the main window
(`plugin-tab:port`, `{instanceId}`), after the guest's `load` event. Both
preloads forward their end to their page with `window.postMessage` — the guest
receives `{type: "cadencr-tab:port"}`, the renderer `{type:
"cadencr-plugin-tab:port", instanceId}` (check `event.source === window`). The
SDK listens from module evaluation so an early port is never missed. Theme CSS
is inserted by the guest preload (`webFrame.insertCSS`) before the first
script runs. The broker replaces any previous port for that
instance and waits for `hello`.

## 6. Scopes

| Scope | Grants |
| --- | --- |
| `features:read` | The bound project and feature, their features list, feature events. |
| `git:read` | Status, diff, log, branches of the bound feature; `git.status` stream. |
| `forge:read` | PR/MR status of the bound feature; `forge.status` stream. |
| `files:read` | File tree and file contents in the bound worktree; `files.changes`. |
| `agent:observe` | Agent session history of the bound feature; `session.stream`. |
| `workspace:read` | Projects and features across the workspace; `session.status`. |

Always available, no scope: context, theme, `state`, `storage`, `config`,
`ui.*`. `net.fetch` requires `network.allowed_origins`.

## 7. Wire protocol (guest ⇄ broker)

Structured-clone objects over the `MessagePort`, `v: 1`.

```ts
type GuestToHost = { v: 1; kind: "request"; id: string; method: string; params?: unknown };
type HostToGuest =
  | { v: 1; kind: "response"; id: string; result: unknown }
  | { v: 1; kind: "response"; id: string; error: { code: string; message: string; details?: unknown } }
  | { v: 1; kind: "event"; event: string; payload: unknown };
```

| Method | Params → result |
| --- | --- |
| `hello` | `{sdkVersion, apiVersions:[min,max]}` → `{apiVersion, instanceId, plugin:{id,version}, context, theme, capabilities: string[]}` |
| `api.request` | `{method, path, query?: Record<string,string>, body?: string (JSON text)}` → `{status, headers, body: ArrayBuffer\|null}` |
| `streams.subscribe` | `{topic, params?}` → `{subscriptionId}` |
| `streams.unsubscribe` | `{subscriptionId}` → `null` |
| `storage.get` / `storage.set` / `storage.delete` / `storage.list` | `{key}` / `{key, value}` / `{key}` / `{}` |
| `state.get` / `state.set` | `{}` → `unknown` / `{value}` (per instance, host memory, ≤ 1 MiB) |
| `config.get` | `{}` → `Record<string, unknown>` |
| `net.fetch` | `{url, method?, headers?, body?: ArrayBuffer}` → `{status, headers, body: ArrayBuffer}` |
| `ui.toast` | `{title, description?, variant?: "default"\|"success"\|"error"}` |
| `ui.openExternal` | `{url}` — `https:` only, after a host confirmation |
| `ui.setBadge` | `{text: string\|null}` — ≤ 4 chars, shown on the tab trigger |

`storage.get`/`state.get` return `null` when empty, `storage.list` returns
`string[]`; `ui.*`, `storage.set/delete`, `state.set` and
`streams.unsubscribe` return `null`. The broker must accept a repeated `hello`
on the same port (React StrictMode re-mounts). The SDK sets
`data-cadencr-theme`, `data-appearance` and `color-scheme` on `<html>`.

Events: `context.changed {context}`, `theme.changed {theme}`,
`visibility.changed {visible}`, `stream.event {subscriptionId, seq, data:
{domain, action, payload}}`, `stream.resync {subscriptionId}` (the plugin
should refetch), `stream.error {subscriptionId, error}`.

Error codes: `PLUGIN_API_UNSUPPORTED`, `CAPABILITY_DENIED`,
`PLUGIN_SCOPE_DENIED`, `PLUGIN_BINDING_DENIED`, `PLUGIN_NETWORK_DENIED`,
`NOT_FOUND`, `BAD_REQUEST`, `TIMEOUT`, `DISCONNECTED`, `HOST_ERROR`.

```ts
interface TabContext {
  project: { id: number; name: string; path: string };
  feature: { id: number; name: string; branch: string | null; baseBranch: string | null;
             worktreePath: string | null };
  pullRequest: { number: number; url: string; state: string; title: string | null } | null;
  session: { id: number | null; provider: string | null; status: string | null } | null;
}
interface ThemeSnapshot {
  id: string;
  appearance: "light" | "dark";
  tokens: Record<string, string>; // "background" → "#0f1115" (no leading "--")
}
```

## 8. Authoring

**Settings → Custom tabs → Create** asks for a name, then the service:

1. derives the id (`slugify`, unique), creates `~/.cadencr/plugins/tabs/<id>/`,
   `git init`, writes the scaffold, commits;
2. creates a project (`authoring_target='tab'`, `plugin_id=<id>`), a feature
   with `worktree_mode=skip`, and a conversation;
3. records consent and enables the tab for that project.

The scaffold is a Vite + React + Tailwind v4 app depending on
`@cadencr/tab-sdk` and `@cadencr/tab-kit` (vendored tarballs under `vendor/`
until the packages are on npm), with `INSTRUCTION.md`, `AGENTS.md` and
`CLAUDE.md` telling the author's agent the contract, and `npm run build` /
`npm run dev` (`vite build --watch`). Every change to `tab.json` or `dist/`
reloads live instances.

## 9. SDK and kit

- `@cadencr/tab-sdk` (`packages/tab-sdk`): `connect()`, context, theme,
  `api` (+ a generated, typed client of the plugin surface), `streams`,
  `storage`, `state`, `config`, `net.fetch`, `ui`, `capabilities`; React
  bindings in `@cadencr/tab-sdk/react`; a fake host in
  `@cadencr/tab-sdk/testing`; the wire types in `@cadencr/tab-sdk/protocol`
  (imported by the renderer broker). No runtime dependencies.
- `@cadencr/tab-kit` (`packages/tab-kit`): `tokens.css` (default values),
  `preset.css` (Tailwind v4 `@theme inline` mapping onto `--cadencr-*`), Inter
  (the desktop UI face), React components built from
  `packages/desktop/src/components/ui` (no fork), and a few kit-native layout
  primitives desktop has no equivalent for (`Card*`, `Label`, `EmptyState`). Peer dependencies: `react`, `react-dom`.

Both are versioned independently of the app (0.x) and target public npm with
trusted publishing; nothing is published without the maintainer's approval.
