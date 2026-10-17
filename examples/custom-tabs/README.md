# Custom tab examples

Working [custom tabs](../../docs/CUSTOM_TABS.md): web UIs Cadencr shows as a
tab on a conversation page. Each folder is laid out like the project Cadencr
scaffolds from **Settings → Custom tabs → Create** (same `package.json`
scripts, `tsconfig.json`, Vite config and `src/main.tsx`). What the scaffold
writes in and this repository keeps once — the `@cadencr/tab-sdk` and
`@cadencr/tab-kit` tarballs (`vendor/`) and the agent documents
(`INSTRUCTION.md`, `AGENTS.md`, `CLAUDE.md`) — is copied in by
`npm run vendor` ([`vendor.mjs`](./vendor.mjs)) and gitignored.

| Example                                  | Shows                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`files-graph`](./files-graph)           | A treemap of the feature's changed files with a diff side panel. The typed API (`getChangedFiles`, `getFileDiff`), the live `git.status` stream with a debounced refetch, `useStorage`, `useVisibility`, the tab badge, and chart colors taken from theme tokens. Permission: `git:read`. |
| [`endpoint-watcher`](./endpoint-watcher) | A GitHub repository's open pull requests and workflow runs. Configuration fields (`config.get()`), a secret substituted server-side (`{{secret:token}}`), egress through `net.fetch` to `network.allowed_origins`, and `ui.openExternal`. No permission.                                  |

## Build one

From the repository checkout:

```sh
cd examples/custom-tabs/files-graph
npm run vendor       # vendor/*.tgz + INSTRUCTION.md, AGENTS.md, CLAUDE.md
npm install
npm run build        # tsc --noEmit && vite build → dist/
```

After changing `packages/tab-sdk` or `packages/tab-kit`, run
`pnpm vendor:tab-packages` at the repository root, then `npm run vendor` again
and reinstall (`rm -rf node_modules && npm install`): npm caches a `file:`
tarball by its integrity hash.

## Install it in Cadencr

Copy the folder — with `dist/` and `vendor/`, without `node_modules/` — to
`~/.cadencr/plugins/tabs/<id>/`, where `<id>` is the manifest's `id` (the
folder name must match it):

```sh
rsync -a --exclude node_modules examples/custom-tabs/files-graph/ ~/.cadencr/plugins/tabs/files-graph/
```

Cadencr picks it up live. In **Settings → Custom tabs**, approve its
permissions and network origins, enable it for a project, then add it from the
**+** menu of any conversation in that project.

The installed folder is self-contained, like a scaffolded tab: run
`npm install` there once, then `npm run dev` to rebuild `dist/` on every save
(Cadencr reloads the open tab after each build). To change it with an agent,
open the installed folder as a project in Cadencr; its `INSTRUCTION.md` is the
contract the agent reads first. (`npm run vendor` only works inside the
checkout; the installed folder already has what it copies.)

## Further reading

- [`docs/CUSTOM_TABS.md`](../../docs/CUSTOM_TABS.md) — the contract: manifest,
  permissions, policy table, wire protocol.
- [`packages/tab-sdk/README.md`](../../packages/tab-sdk/README.md) — the SDK:
  `connect()`, React hooks, the typed API client, the test host.
- [`packages/tab-kit/README.md`](../../packages/tab-kit/README.md) — theme
  tokens, the Tailwind preset and the components.
