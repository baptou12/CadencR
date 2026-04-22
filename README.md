# Cadence

Cadence is a Tauri desktop app with a React frontend and Rust backend for driving local coding agents through a desktop UI.

## Prerequisites

- Node.js 22+
- `pnpm`
- Rust toolchain
- Tauri system dependencies for your platform

## Quickstart

1. Install dependencies:

```bash
pnpm install
```

2. Create your local env files:

```bash
cp packages/service/.env.example packages/service/.env
cp packages/tauri/.env.example packages/tauri/.env
```

3. Set matching local values in both files:

```bash
# packages/service/.env
CADENCE_AUTH_TOKEN=replace-with-a-random-local-token
CADENCE_FRONTEND_PORT=1420
CADENCE_RUST_PORT=5005

# packages/tauri/.env
VITE_API_TOKEN=replace-with-the-same-local-token
VITE_FRONTEND_PORT=1420
VITE_API_URL=http://127.0.0.1:5005
```

4. Start the app:

```bash
pnpm dev
```

The example files use frontend port `1420`, service port `5005`, and `./cadence.local.db` for the service database. Override those values in `packages/service/.env` and `packages/tauri/.env` if you need multiple local clones running at once.

## Useful Commands

```bash
pnpm dev
pnpm start
pnpm test
pnpm run lint
```

## Local Configuration

- `packages/service/.env` is required for service dev and is read only by the service.
- `packages/tauri/.env` is required for desktop/frontend dev and is read only by Tauri and Vite.
- Missing either required `.env` file, or required keys within it, fails fast during dev startup.
- Keep `CADENCE_FRONTEND_PORT` and `VITE_FRONTEND_PORT` aligned.
- Point `VITE_API_URL` at the service URL from `CADENCE_RUST_PORT`.
- Keep `CADENCE_AUTH_TOKEN` and `VITE_API_TOKEN` aligned.
- `CADENCE_DB_PATH` sets the local service database path.

## Architecture

- `packages/tauri/`: desktop shell and React frontend
- `packages/service/`: Rust HTTP/WebSocket backend
- `packages/claude-agent-sdk-rs/`: Rust SDK support crate

The frontend talks to the backend over HTTP and WebSockets. In production, Tauri spawns the Rust service as a sidecar.

## Contributing

See `CONTRIBUTING.md` for local development and contribution notes.
