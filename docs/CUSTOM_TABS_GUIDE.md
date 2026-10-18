# Custom tabs — guide

Custom tabs let you put any web UI next to Agent, Terminal, Git, Editor and
Browser in a conversation: a graph of what the feature changed, your team's CI
dashboard, a bridge to an in-house tool. You build them; Cadencr hosts them,
themes them and hands them the conversation's context.

This guide covers using and building them. The contract every part follows is
[Custom tabs](./CUSTOM_TABS.md); API details live in the
[`@cadencr/tab-sdk`](../packages/tab-sdk/README.md) and
[`@cadencr/tab-kit`](../packages/tab-kit/README.md) READMEs. Working examples
are in [`examples/custom-tabs`](../examples/custom-tabs/README.md).

Custom tabs are desktop only for now. The phone and remote views show a
placeholder instead.

## Using a custom tab

1. **Turn it on.** Open **Settings → Custom tabs**. Each tab lists what it can
   read (its permissions) and which websites it may contact. Enable it for every
   project with **Enable in all projects**, or per project with
   **Inherit / On / Off**. The first time, Cadencr asks you to accept its
   permissions. If a later version asks for more, the tab pauses until you
   accept again.
2. **Add it to a conversation.** Click **+** at the end of the tab strip and
   pick the tab. It behaves like the built-in tabs: drag it into a split, move
   it between panes, close it with **×**. Closing removes it from that
   conversation only.
3. **Configure it.** If the tab declares settings, they appear on its card in
   Settings: global values, values per project, and secrets. A secret is stored
   by Cadencr and never shown again, not even to the tab itself (see
   [Network access and secrets](#network-access-and-secrets)).

The **+** menu also shows actions for the focused custom tab: **Reload**,
**Open DevTools** and **Open source project**.

When a tab can't run, it says why in place: not built yet, invalid
`tab.json`, turned off for this project, crashed (with **Reload**), or not
available on this device.

## Creating a custom tab

**Settings → Custom tabs → Create custom tab**, or **Create custom tab…** in the
**+** menu. Give it a name. Cadencr then:

- creates `~/.cadencr/plugins/tabs/<id>/`, a Git repository with a starter tab
  (Vite, React, TypeScript, Tailwind v4, the tab SDK and kit);
- creates a project for it with an agent conversation, and places the new tab in
  that conversation;
- turns the tab on for that project.

Ask the agent what the tab should show. The starter's `INSTRUCTION.md`
(mirrored in `AGENTS.md`/`CLAUDE.md`) teaches it the contract, the SDK, the
permissions and the design rules. Then:

```bash
npm install
npm run dev     # vite build --watch — Cadencr reloads the tab on every rebuild
```

Cadencr serves `dist/` (the folder holding `entry`). Sources and `tab.json` are
never served. A change to `tab.json` is picked up live too. If it widens the
permissions, you are asked to accept them again.

## Building one

### The manifest

`tab.json` declares who the tab is and what it may do:

```json
{
  "schema_version": 1,
  "kind": "tab",
  "id": "files-graph",
  "name": "Files graph",
  "version": "0.1.0",
  "api_version": 1,
  "entry": "dist/index.html",
  "tab": { "label": "Files graph" },
  "permissions": ["git:read"],
  "network": { "allowed_origins": [], "reasoning": null },
  "configuration": []
}
```

Rules are in [CUSTOM_TABS.md §3](./CUSTOM_TABS.md#3-manifest--tabjson);
`cadencr plugin validate --kind tab <dir>` checks a folder. Settings shows the
same errors on the tab's card.

### Permissions

| Permission       | What the tab can read                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| `features:read`  | This conversation's feature and project, and the project's other features.              |
| `git:read`       | Status, diffs, history and branches of this conversation's worktree; live `git.status`. |
| `forge:read`     | The pull/merge request of this conversation; live `forge.status`.                       |
| `files:read`     | Files of this conversation's worktree; live `files.changes`.                            |
| `agent:observe`  | The agent conversation's history and live `session.stream` (read only).                 |
| `workspace:read` | Every project and feature; live `session.status`.                                       |

A tab never gets your Cadencr token. Each open tab receives a short-lived grant
for **its** conversation only. The service checks every request against a fixed
list of read-only routes, so a tab cannot send prompts, answer permission gates,
change settings or reach another conversation.

### The SDK

```tsx
import { CadencrProvider, useTabContext, useStream } from "@cadencr/tab-sdk/react";
import { getChangedFiles } from "@cadencr/tab-sdk/api";

function App() {
  const { feature } = useTabContext(); // project, feature, branch, PR, session
  const [files, setFiles] = useState<string[]>([]);
  const refresh = () =>
    getChangedFiles({ feature_id: feature.id, mode: "uncommitted" }).then((f) =>
      setFiles(f.map((x) => x.file)),
    );
  useEffect(() => void refresh(), [feature.id]);
  useStream("git.status", () => void refresh()); // pushed live, no polling
  return (
    <ul>
      {files.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

createRoot(root).render(
  <CadencrProvider>
    <App />
  </CadencrProvider>,
);
```

The client also has the following:

- **`storage`**: a key/value store for each tab and project, kept by Cadencr.
- **`state`**: per-instance state that survives reloads.
- **`config`**: the tab's settings, without secrets.
- **`net.fetch`**: see the next section.
- **`ui`**: a toast, opening a link (the user confirms), and a badge on the tab.
- **`capabilities`**: what the host supports.

`@cadencr/tab-sdk/testing` provides a fake host so you can unit-test a tab
without Cadencr.

### Look native

Import the kit once:

```css
@import "tailwindcss";
@import "@cadencr/tab-kit/preset.css";
```

Use its components (`Button`, `Card`, `Badge`, `Tabs`, `Tooltip`, `Select`,
`EmptyState`…) and the theme utilities (`bg-background`, `text-muted-foreground`,
`bg-chart-2`…). They are built from Cadencr's own design system and follow the
user's theme, light or dark, live. Never hardcode colors.

### Network access and secrets

A tab has no network of its own. To call another service, declare its origin
and say why:

```json
"network": {
  "allowed_origins": ["https://gitlab.example.com"],
  "reasoning": "Reads merge-request pipelines from the team GitLab."
},
"configuration": [
  { "key": "token", "type": "secret", "label": "Access token", "scope": "global" }
]
```

Then call `client.net.fetch(url, { headers: { Authorization: "Bearer {{secret:token}}" } })`.
Cadencr makes the request, substitutes the secret on its side and returns the
response. The tab code never sees the token. Requests to other origins, and to
private network addresses, are refused.

## Limits in this version

- Desktop only. The phone and remote views show a placeholder.
- At most six custom tabs stay alive at once; a hidden one beyond that is
  unloaded and comes back, with its `state`, when shown again.
- While a custom tab has keyboard focus, only the pane shortcuts
  (⌘⇧A/T/G/E/B) reach Cadencr.
- Every plugin route is `proposed`: it may still change before custom tabs can
  be published. The SDK and kit are versioned `0.x` and ship vendored inside the
  starter until they are published on npm.

## Publish a custom tab to the marketplace

Build the tab first (`pnpm build` in its author project). Open the project's
settings and use **Custom tab publication preparation**, then **Prepare a custom
tab bundle**. These sections are available in development builds with
`VITE_INTERNAL_MARKETPLACE=true`, like the rest of the unreleased marketplace.

The metadata uses the signed catalog's schema-2 `tab` kind. This is a template,
not publishable metadata: replace the checksum and `FIRST_COMPATIBLE_APP_VERSION`
before preparation. The first desktop release with marketplace-tab support has
not been selected yet; released `0.13.1` does **not** support these packages.

```json
{
  "kind": "tab",
  "package": {
    "tab": {
      "id": "files-graph",
      "name": "Files graph",
      "description": "Explore changed files",
      "version": "1.0.0",
      "repository": "https://github.com/acme/files-graph",
      "license": "MIT",
      "api_version": 1,
      "distribution": {
        "archive": "https://github.com/acme/files-graph/releases/download/v1.0.0/tab.tar.gz",
        "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
      }
    },
    "host": {
      "publisher": "acme",
      "compatibility": { "min_app_version": "FIRST_COMPATIBLE_APP_VERSION" }
    }
  }
}
```

Use the actual first compatible app version or a later tested release for
`min_app_version`; the placeholder deliberately fails semantic-version validation.
Keep the mixed tab catalog separate from feeds consumed by older clients: their
parsers can reject the unknown `tab` kind before compatibility filtering.

The ID, name, version and API version must match `tab.json`. Preparation replaces
the placeholder checksum with the actual SHA-256 and captures only `tab.json`,
the declared SVG icon and the directory containing the compiled HTML entry.
The distributed entry must be inside a web directory such as `dist/index.html`.
Sources, dependencies, Git history, symlinks and executable file modes are not
distributed. Both compressed and unpacked archives are limited to 32 MiB.

Review the prepared bundle, create the source release, then generate and submit
the registry contribution through the existing publication workflow. Preparing a
bundle alone publishes nothing; the registry still verifies and signs its catalog.

For headless packaging, assemble that same distribution tree and run:

```sh
cadencr registry pack-tab --directory ./staging --output ./tab.tar.gz
```

For release preparation, add `--package ./marketplace-package.json` to bind the
compiled manifest's identity, version and API version to reviewed schema-2 metadata.

Marketplace tabs share the mixed catalog source and signing trust already used
by themes (`CADENCR_MANAGED_THEME_INDEX_URL`); no separate signing key is needed.
They appear under **Custom tabs** in the marketplace and install into immutable
revisions under `plugins/managed-tabs`, separate from editable `plugins/tabs`
projects. Installation does not grant permissions. Enable the tab through the
existing consent dialog; changes to its permissions or network origins require
consent again. Updates and removal keep configuration, while installation refuses
to overwrite a local author tab with the same ID.
