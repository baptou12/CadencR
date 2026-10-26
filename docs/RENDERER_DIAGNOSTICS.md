# Renderer error diagnostics

These diagnostics help investigate errors such as React #185. They do not fix
the application's nested-update loop or identify its origin from the last frame.

## Error sources

Electron persists renderer reports in `renderer-errors.log` under its logs
directory. The React root hooks preserve console error logging and report:

| Source | Context |
| --- | --- |
| `react-boundary` | React caught an error, including in a local boundary |
| `react-uncaught` | React could not find a boundary |
| `react-recoverable` | React recovered automatically |
| `error`, `unhandledrejection` | Browser-level errors; no React component stack is available |

The existing `GlobalErrorBoundary` and `RootErrorBoundary` already forward
`componentStack`; the Electron logger already preserves it. A record with source
`error` and `componentStack: unavailable` does not demonstrate a broken transfer.
Timers and store callbacks can throw outside React's error handling. Root hooks
cannot invent a component stack for those errors, and a component stack names the
throw site, which need not be the component driving a nested-update loop.

React reporting is capped at 20 occurrences per page lifetime, independently of
the existing 20-report browser-handler cap. Root and boundary reports for the
same error object in one commit are consolidated in a microtask, retaining the
longer component stack. Reusing the same error object in a later occurrence can
produce another report within the budget. Console logging and fallbacks remain.
Outside Electron, the existing browser bridge does not persist reports.

## Opt-in source maps

From the repository root, build with the locked dependencies and Node version:

```sh
CADENCR_RENDERER_SOURCEMAPS=1 pnpm --filter @cadencr/desktop exec electron-vite build
```

This emits hidden renderer maps in `packages/desktop/out/renderer/assets` without
`sourceMappingURL` comments. Maps include source content. The default build still
omits maps. Electron's existing renderer resource copy will include them if that
opt-in output is packaged; hidden maps are not an access-control mechanism.

For a published build, the release job must enable this option **during the
actual build being packaged**, then archive its exact JavaScript assets and maps
together with the commit, lockfile, tool versions, target architecture and asset
SHA-256 hashes. Retrieve that matching CI artifact for the affected release and
verify that the logged bundle's bytes/hash match before symbolicating its
one-based line and column. Keep archives outside the served renderer if maps
should not ship to users.

This change does not enable maps or artifact archival in release CI. It supplies
an opt-in diagnostic build tool, not deployed symbolication. An old published
bundle with no retained matching maps cannot reliably be symbolicated by a local
rebuild, even from the same commit. Reproduce with an archived diagnostic build
to capture new offsets instead.
