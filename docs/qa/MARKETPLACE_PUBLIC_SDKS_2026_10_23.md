# Public SDK external-author acceptance — 2026-10-23

## Scope and result

**PASS for public-package consumption on Darwin arm64**, not packaged Marketplace installation. Fresh temporary projects downloaded released `0.1.0` packages from npm/crates.io; neither used workspace/path dependencies, source aliases, nor monorepo-vendored SDK artifacts. Rust output used the required worktree target directory only.

Environment: Node `22.19.0`, npm `10.9.8`, Rust `1.96.0`. Read the SDK READMEs and provider/backend contracts before constructing consumers.

| Published artifact                | Actual verification                                                                                                                                    | Result                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `@cadencr/tab-sdk@0.1.0`          | Root, `/react`, `/api`, `/protocol`, `/testing` imports; fake-host connection/version handshake; API JSON response; storage round-trip; config         | Pass                  |
| `@cadencr/tab-kit@0.1.0`          | React `Button`, `Badge`, `Card` consumer; strict TypeScript with `skipLibCheck: false`; Vite 7 + Tailwind 4 preset build, including local Inter assets | Pass                  |
| `cadencr-tab-backend = "=0.1.0"`  | External native handler build with `api` and `conformance`; released crate conformance runner against built binary                                     | All seven checks pass |
| `cadencr-provider-sdk = "=0.1.0"` | External `CadencrProvider` implementation; native command execution                                                                                    | Pass; details below   |

## Reproduction and retained evidence

Temporary projects and logs (local, not committed):

- `/private/tmp/cadencr-public-sdk-20261023-npm`: `package-lock.json`, `smoke.mjs`, `src/main.tsx`, `src/style.css`, `vite.config.mjs`, `tsconfig.json`, `install.log`, `runtime.log`, `types.log`, `build.log`.
- `/private/tmp/cadencr-public-sdk-20261023-rust`: `Cargo.toml`, `Cargo.lock`, `src/bin/{backend,provider,check}.rs`, `build.log`, `commands.log`, `conformance.log`.

```sh
# npm scratch directory: public dependencies only; no lifecycle scripts
npm install --registry=https://registry.npmjs.org --ignore-scripts --no-audit --no-fund \
  @cadencr/tab-sdk@0.1.0 @cadencr/tab-kit@0.1.0 react@19 react-dom@19 \
  typescript@5 @types/react@19 @types/react-dom@19 radix-ui \
  class-variance-authority clsx vite@7 tailwindcss@4 @tailwindcss/vite@4
node smoke.mjs
./node_modules/.bin/tsc
./node_modules/.bin/vite build

# Repository root: wrapper builds the independent external manifest
node scripts/cargo-env.mjs cargo build \
  --manifest-path /private/tmp/cadencr-public-sdk-20261023-rust/Cargo.toml
./target/debug/check "$PWD/target/debug/backend"
./target/debug/provider version
./target/debug/provider models --format acp-config-options-v1 --cwd /private/tmp
./target/debug/provider run --protocol acp-v1
./target/debug/provider updates --format cadencr-updates-v1
```

`Cargo.lock` inspection confirmed every dependency has a registry source; only the scratch root package has no source. npm lock inspection confirmed no linked packages and both SDK tarballs resolve under `https://registry.npmjs.org/@cadencr/`. Lockfiles retain all transitive versions/integrities.

| Crate                        | crates.io lock checksum                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `cadencr-tab-backend 0.1.0`  | `3c7b1f7d0a740c8669796dce20ed5c657e2f5b5670a8582beff83a34cf8eb229` |
| `cadencr-provider-sdk 0.1.0` | `07b6ade8d72ae4462cfd4ae107db16d1ffd8fb959176b83947c0d5175d57a391` |

## Runtime observations

- Backend: `Starts`, `Ready` (protocol `1`, helper version `0.1.0`), `UnknownMethod`, `MalformedLine`, `ConcurrentRequests`, `ExitOnStdinClose`, `StdoutClean` all `Passed`. Exit was status `0` within the two-second grace.
- Provider `version`: `0.1.0-smoke`; `models`: one valid `select`/`model` option with default `smoke`; `run`: dispatches the supplied implementation and exits `0`.
- Optional `updates`: `{"supported":false}` with exit `0`. Optional `update`: actionable JSON message and exit `1`, as expected for the default unsupported implementation.
- Invalid model format and invalid runtime protocol each exit `1` with a diagnostic on stderr.
- Type checking exited `0`; Vite built in `655 ms`, emitted CSS/JS and Inter font files. This is a production bundle build, not browser rendering or visual QA.

## Boundaries and execution caveats

- The provider smoke implements command dispatch and a static model catalog, **not a real ACP agent**. No live provider session, credential flow, model inference, or update installation was claimed.
- SDK runtime uses the published fake host, **not the running desktop host**. Backend conformance invokes a native process, but does not exercise scoped HTTP API calls, platform-signature admission, signed package acquisition, app installation, or packaged Marketplace lifecycle.
- No package publication or remote mutation occurred. No concrete published-SDK defect was observed.
- Sandbox network access initially failed DNS; downloads succeeded after approved network escalation. `pnpm rust` attempted automatic dependency installation and stopped on a no-TTY prompt; the explicitly permitted `node scripts/cargo-env.mjs cargo …` wrapper succeeded instead. A subsequent optional offline `cargo metadata` probe could not fetch an unneeded platform dependency (`cc`); build/runtime results above were already successful. Registry-source verification used the lockfile instead.
