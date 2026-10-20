# Port monitor

A **native code** custom tab: the local servers listening on TCP
ports, the process behind each, and which ones run in this conversation's
folder — with a **Stop** button for those. A page cannot list processes or send a
signal, and no single command does all of it, so the tab ships its own
backend: [`backend/server.mjs`](./backend/server.mjs), plain Node with no
dependencies.

## The backend

`tab.json` declares how Cadencr starts it, and why:

```json
"permissions": ["features:read"],
"backend": {
  "command": "node",
  "args": ["backend/server.mjs"],
  "reasoning": "Lists the TCP ports listening on this computer and the process behind each (lsof, or netstat on Windows), and stops a process started in this conversation's folder when you ask."
}
```

Cadencr runs `node` from your `PATH`, with this folder as the working
directory, on the tab's first `client.backend.request()`, and stops it 30 s
after the tab is closed, when the tab is turned off, or when its permissions
change. It speaks JSON lines ([CUSTOM_TABS.md §4.7](../../../docs/CUSTOM_TABS.md#47-native-backend-backendrequest)):

| Direction    | Line                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| stdin, first | `{"type":"hello","feature_id","project_id","worktree","scopes","api":{"base_url","token_header","token"}}` |
| stdin        | `{"type":"request","id","method","params"}`                                                                |
| stdout       | `{"type":"response","id","result"}` or `{"type":"response","id","error":{"code","message"}}`               |
| stderr       | its log, shown in **+ → Activity…**                                                                        |

Its methods:

| Method    | Does                                                                                                                                    |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `context` | Reads the conversation's title from the Cadencr API with the backend's own token (`features:read`, this conversation only).             |
| `ports`   | `lsof -nP -iTCP -sTCP:LISTEN` (+ each process's working directory) or `netstat -ano` + `tasklist` on Windows.                           |
| `stop`    | `SIGTERM` to a process that is listening **and** whose working directory is inside the conversation's folder; anything else is refused. |

The page calls them through the SDK and polls `ports` every 5 s while shown:

```ts
const { ports } = await client.backend.request<{ ports: PortEntry[] }>("ports");
await client.backend.request("stop", { pid });
```

## What the user sees

The backend runs with the user's rights and Cadencr does not sandbox it. It
says so at every step:

- **Settings → Custom tabs**: a "Native code" badge; under the permissions,
  the launch line `node backend/server.mjs`, its reason and a warning that it
  can read and change any file and use the network.
- **Consent**: the dialog leads with the same warning and only allows the tab
  once **I trust this code to run on my computer with my rights** is ticked.
- **The tab strip**: a chip glyph on the tab and in the **+** menu.
- **+ → Activity…**: whether the backend runs, its pid, why it last stopped,
  its stderr log, and **Stop**.

Its Cadencr access stays limited to `features:read` for this conversation,
like the page's: the `hello` token is not the app's own.

A folder is not a conversation: conversations without their own worktree
share the project folder, so their servers show up, and can be stopped, from
each of them. Windows does not report another process's working directory, so
there no port counts as in the folder and **Stop** is not offered.

Build and install it like the other examples ([README](../README.md)).
