# CLAUDE.md

## Monorepo Structure

This is a pnpm workspaces + Turborepo monorepo. The desktop app lives in `packages/tauri/` (Tauri v2 + React frontend).

- Run tasks via turbo from root: `pnpm turbo run <task>` (e.g., `pnpm turbo run lint`, `pnpm turbo run test`)
- Or target the desktop package directly: `pnpm --filter @cadence/desktop <task>`
- Dev server: `pnpm dev` or `pnpm start` from root (frontend on port 1420, service on port 5005)

## Architecture

The app uses Tauri v2 as the desktop shell with a React frontend. The backend is a Rust API server (`packages/service/`) spawned as a sidecar in production. In dev mode, run cadence-service manually. The frontend communicates with the backend via HTTP (Axios) and WebSocket (Zustand store). Folder selection uses `@tauri-apps/plugin-dialog`.

Frontend path alias: `@` → `packages/tauri/src/` (e.g., `import { foo } from "@/lib/foo"`)

## Critical Constraints

- Use `pnpm` (not npm/yarn)
- Lint with `pnpm run lint` (oxlint via turbo), test with `pnpm test` (vitest via turbo)
