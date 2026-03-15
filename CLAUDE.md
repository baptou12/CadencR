# CLAUDE.md

## Monorepo Structure

This is a pnpm workspaces + Turborepo monorepo. Source code lives in `packages/electron/`.

- Run tasks via turbo from root: `pnpm turbo run <task>` (e.g., `pnpm turbo run lint`, `pnpm turbo run test`)
- Or target the electron package directly: `pnpm --filter @cadence/electron <task>`
- Dev server: `pnpm dev` or `pnpm start` from root

## Migration: Electron → Rust API + WebSocket

We are actively migrating away from the Electron backend toward a Rust API server with WebSocket support. Every change must move in this direction. Do NOT add new Electron/tRPC backend logic — instead, implement new backend functionality in Rust and expose it via the API or WebSocket layer. The frontend will remain (React), but all backend concerns should target the Rust stack. Prefer WebSocket for real-time data and streaming — avoid polling or repeated API calls when a WebSocket subscription can serve the same purpose.

## Critical Constraints

- Do NOT upgrade tRPC beyond v10 or React Query beyond v4 — `electron-trpc` requires these exact major versions
- Use `pnpm` (not npm/yarn)
- Lint with `pnpm run lint` (oxlint via turbo), test with `pnpm test` (vitest via turbo)
