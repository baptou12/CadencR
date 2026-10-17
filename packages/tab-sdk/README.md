# @cadencr/tab-sdk

The SDK for Cadencr **custom tabs**: web UIs that Cadencr shows as a
feature-page tab, next to Agent, Terminal, Git, Editor and Browser. The tab runs
in an isolated view with no network; everything it reads goes through a
`MessagePort` to the Cadencr host. This package speaks that protocol for you.

The contract is in Cadencr's
[`docs/CUSTOM_TABS.md`](https://github.com/merkr-software/CadencR/blob/main/docs/CUSTOM_TABS.md).

## Quick start

```ts
import { connect } from "@cadencr/tab-sdk";

const cadencr = await connect();

console.log(cadencr.context.feature.name); // the feature this tab is open in
cadencr.onContextChange((context) => render(context));

const status = await cadencr.api.get("/api/git/status", {
  query: { feature_id: cadencr.context.feature.id },
});

cadencr.streams.subscribe("git.status", (event) => update(event.data.payload), {
  onResync: () => refetchEverything(),
});
```

`connect()` waits for the port the Cadencr preload posts to the page, performs
the `hello` handshake and applies the Cadencr theme to `<html>` (see
[Theme](#theme)). The SDK starts listening for that port as soon as it is
imported, so calling `connect()` late never misses it. When the host reloads
its side it sends a new port: the client re-handshakes, re-subscribes every
stream and calls each stream's `onResync`.

### React

```tsx
import { CadencrProvider, useStream, useTabContext } from "@cadencr/tab-sdk/react";

function App() {
  return (
    <CadencrProvider
      fallback={<p>Connecting…</p>}
      errorFallback={(error) => <p>Cannot reach Cadencr: {error.message}</p>}
    >
      <Feature />
    </CadencrProvider>
  );
}

function Feature() {
  const context = useTabContext();
  useStream("git.status", (event) => console.log(event.data));
  return <h1>{context.feature.name}</h1>;
}
```

## API

### `connect(options?) → Promise<CadencrClient>`

| Option             | Default            | Meaning                                                      |
| ------------------ | ------------------ | ------------------------------------------------------------ |
| `timeoutMs`        | `10000`            | Wait for the port and the `hello` reply.                     |
| `requestTimeoutMs` | `30000`            | Default per-request timeout.                                 |
| `applyTheme`       | `true`             | Write the theme onto `<html>` now and on every change.       |
| `transport`        | the window message | A `PortSource` or a `MessagePort` (tests use the fake host). |

Rejects with a `CadencrError`: `PLUGIN_API_UNSUPPORTED` when the host speaks no
common API version, `TIMEOUT` when nothing answers (the page is not running in a
Cadencr custom tab).

### `CadencrClient`

| Member                                                                | Description                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `context`, `onContextChange(cb)`                                      | Project, feature, pull request and session of the tab (`TabContext`).                                             |
| `theme`, `onThemeChange(cb)`                                          | The Cadencr theme (`ThemeSnapshot`: `id`, `appearance`, `tokens`).                                                |
| `visible`, `onVisibilityChange(cb)`                                   | Whether the tab is shown. Pause expensive work while hidden.                                                      |
| `instanceId`, `plugin`, `apiVersion`                                  | From the handshake.                                                                                               |
| `capabilities.list`, `capabilities.isSupported(name)`                 | Capabilities the host announced.                                                                                  |
| `api.request({ method, path, query?, body? })`                        | Call the plugin surface of the Cadencr service. Resolves an `ApiResponse` for every status.                       |
| `api.get/post/put/patch/delete<T>(path, …)`                           | JSON helpers: resolve the body, throw `CadencrError` (service `code`, `status`) on non-2xx.                       |
| `streams.subscribe(topic, handler, { params?, onResync?, onError? })` | Live events. Returns `{ unsubscribe() }`. A `seq` gap, a host resync or a reconnect calls `onResync`: refetch.    |
| `storage.get/set/delete/list`                                         | The plugin's key/value store, per project (JSON values, ≤ 256 KiB each).                                          |
| `state.get/set`                                                       | Per-instance state in host memory; survives the view being recreated.                                             |
| `config.get()`                                                        | Non-secret configuration from the manifest's `configuration` fields.                                              |
| `net.fetch(url, { method?, headers?, body?, timeoutMs? })`            | Fetch from an origin in `network.allowed_origins`. `{{secret:<key>}}` in header values is filled in server-side.  |
| `ui.toast({ title, description?, variant? })`                         | Show a Cadencr toast.                                                                                             |
| `ui.openExternal(url)`                                                | Open an `https:` URL in the browser, after the user confirms.                                                     |
| `ui.setBadge(text \| null)`                                           | Up to 4 characters on the tab trigger.                                                                            |
| `connected`, `onConnectionChange(cb)`                                 | Port lost (`false`) / re-established (`true`).                                                                    |
| `onError(cb)`                                                         | Background failures nobody else handled. Without a listener they are re-thrown asynchronously (`window.onerror`). |
| `call(method, params, { timeoutMs? })`                                | Raw protocol call.                                                                                                |
| `close()`                                                             | Unsubscribe streams and stop talking to the host.                                                                 |

`ApiResponse` mirrors `fetch`'s `Response`: `status`, `ok`, `headers`
(lower-cased), `json()`, `text()`, `arrayBuffer()`.

Stream topics: `git.status`, `session.stream`, `files.changes`, `forge.status`,
`feature.events`, `session.status` — each needs the matching manifest
permission.

### Errors

Every failure is a `CadencrError` with a `code`: `PLUGIN_API_UNSUPPORTED`,
`CAPABILITY_DENIED`, `PLUGIN_SCOPE_DENIED`, `PLUGIN_BINDING_DENIED`,
`PLUGIN_NETWORK_DENIED`, `NOT_FOUND`, `BAD_REQUEST`, `TIMEOUT`, `DISCONNECTED`,
`HOST_ERROR` — or, from `api.*` helpers, the service's own stable code. HTTP
errors also carry `status`.

### Theme

The theme arrives as tokens (`background`, `primary`, `muted-foreground`, …).
The client writes each one onto `<html>` as `--cadencr-<token>`, plus
`data-appearance="light|dark"`, `data-cadencr-theme` and `color-scheme`. Use
the variables directly, or install `@cadencr/tab-kit` for a Tailwind preset and
components that already read them. `applyTheme`, `themeVariables` and
`themeToCss` are exported for custom setups.

### React (`@cadencr/tab-sdk/react`)

| Export                                                                  | Description                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `<CadencrProvider fallback? errorFallback? connectOptions?>`            | Connects on mount, closes on unmount. Without `errorFallback` a failure throws to the nearest error boundary. |
| `useCadencr()`                                                          | The client.                                                                                                   |
| `useTabContext()`, `useTheme()`, `useVisibility()`                      | Live values.                                                                                                  |
| `useStream(topic, handler, { params?, onResync?, onError?, enabled? })` | One subscription for the component's lifetime; inline callbacks are fine.                                     |
| `useStorage(key, initial)`                                              | `{ value, loading, error, set(value) }` for one storage key.                                                  |

### Typed API client

`pluginFetch<T>(url, init)` (and `createPluginFetch(client)`) adapt the client
to an orval `fetch` mutator: it takes a service URL (`/api/…?query`) and a
`RequestInit` with a JSON string body, and resolves the parsed body or throws a
`CadencrError`. A generated, typed client of the plugin surface will be built
on it.

## Testing

`@cadencr/tab-sdk/testing` is a fake host on a standard `MessageChannel`. It
answers `hello` from its options and keeps storage, state and subscriptions in
memory.

```ts
import { connect } from "@cadencr/tab-sdk";
import { createTestHost, jsonResponse } from "@cadencr/tab-sdk/testing";

const host = createTestHost({ config: { group: "directory" } });
host.route("GET", "/api/git/status", jsonResponse(200, { files: [] }));

const client = await connect({ transport: host.transport });
client.streams.subscribe("git.status", onEvent, { onResync });

host.pushStream("git.status", { domain: "git", action: "status", payload: {} });
host.setContext({ ...host.context, pullRequest: null });
host.reconnect(); // simulate a host reload
expect(host.requests.map((r) => r.method)).toContain("streams.subscribe");
```

| `TestHost` member                                                                | Description                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `transport`, `port`                                                              | Pass `transport` to `connect()`.                             |
| `handle(method, handler)`                                                        | Replace a method's handler; throw `CadencrError` to fail it. |
| `route(method, path, response \| handler)`                                       | Answer `api.request`.                                        |
| `setContext`, `setTheme`, `setVisible`, `emit`                                   | Push events.                                                 |
| `pushStream(idOrTopic, data, { seq? })`, `resync`, `streamError`                 | Drive subscriptions.                                         |
| `requests`, `nextRequest(method?)`, `subscriptions`, `storage`, `state`, `badge` | Inspect what the tab did.                                    |
| `reconnect()`, `disconnect()`, `close()`                                         | Host reload, port loss, teardown.                            |

`createTabContext`, `createThemeSnapshot` and `jsonResponse` build fixtures.

## Protocol types

`@cadencr/tab-sdk/protocol` (also re-exported from the root) holds the wire
types and constants shared with the host: `GuestToHost`, `HostToGuest`,
`MethodMap`, `EventMap`, `TabContext`, `ThemeSnapshot`, `API_VERSION`,
`SUPPORTED_API_VERSIONS`, `PORT_MESSAGE_TYPE`, `ERROR_CODES`,
`negotiateApiVersion`.

## License

Apache-2.0
