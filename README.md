# Cadencr

**A desktop IDE for AI coding agents — a unified workspace for Claude Code, OpenCode, and more.**

Cadencr replaces the terminal-based workflow of local coding agents with a structured, visual experience: projects, features, visual diffs, and parallel agent sessions in their own worktrees.

- **Website:** [rle-mino.github.io/cadencr](https://rle-mino.github.io/cadencr/)
- **License:** Apache-2.0

---

## Why Cadencr?

- **Readable diffs** — Visual diff viewer with inline commenting, not raw terminal output.
- **Parallel agents** — Run multiple Claude Code or OpenCode sessions on the same project without stepping on each other.
- **Structured features** — Each feature gets its own worktree and dedicated agent session.
- **Local-first** — Everything runs on your machine. No account, no hosted state.

---

## Install

**Binaries are not yet published.** Until the first release, build from source — see [Build from source](#build-from-source) below.

When releases land, installers for macOS, Linux, and Windows will be available under [GitHub Releases](https://github.com/rle-mino/cadencr/releases).

---

## Build from source

### Prerequisites

- **Node.js 22.x** — managed via [nvm](https://github.com/nvm-sh/nvm), [fnm](https://github.com/Schniz/fnm), or [asdf](https://asdf-vm.com/). Cadencr pins `22` in `.nvmrc`, `.node-version`, and `package.json` engines; `engine-strict=true` makes install fail on a mismatched Node.
- **pnpm** (`npm i -g pnpm`) — `npm` and `yarn` are not supported.
- **Rust toolchain** — install via [rustup](https://rustup.rs).

### Setup

```bash
# 1. Clone
git clone https://github.com/rle-mino/cadencr.git
cd cadencr

# 2. Install
pnpm install

# 3. Create local env files
cp packages/service/.env.example packages/service/.env
cp packages/desktop/.env.example   packages/desktop/.env
```

Edit both `.env` files so the shared values match: any random string for `CADENCR_AUTH_TOKEN` / `VITE_API_TOKEN` (they must be identical), frontend port aligned on both sides (default `1420`), and `VITE_API_URL` pointing at the service port (default `http://127.0.0.1:5005`).

### Run

```bash
pnpm dev
```

This runs the Rust service and the Electron desktop app together via Turborepo.

Other common commands are listed in [CONTRIBUTING.md](./CONTRIBUTING.md#common-commands).

---

## Architecture

```
packages/
├── desktop/                 # Desktop shell (Electron) + React frontend
├── service/                 # Rust HTTP/WebSocket backend (Axum)
├── claude-agent-sdk-rs/     # Rust SDK wrapping the Claude Code CLI
├── opencode-sdk-rs/         # Rust SDK wrapping the OpenCode CLI
└── landing/                 # Astro marketing site
```

- **Frontend ↔ Backend** — HTTP (Axios) for requests, WebSocket (Zustand store) for live agent streams.
- **Backend ↔ CLIs** — Provider-specific SDKs stream and control local agent processes.
- **Production** — Electron spawns the compiled `cadencr-service` binary as a sidecar.

---

## Contributing

Contributions welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development setup, commit convention, and pull request process. Please also read the [Code of Conduct](./.github/CODE_OF_CONDUCT.md).

To report a security issue, use [GitHub's private vulnerability reporting](https://github.com/rle-mino/cadencr/security/advisories/new) — see [SECURITY.md](./.github/SECURITY.md).

---

## License

Apache-2.0 © 2026 Raphael Le Minor. See [LICENSE](./LICENSE).

Third-party dependency and brand-asset attributions are listed in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
