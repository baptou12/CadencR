# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Structure

This is a pnpm workspaces + Turborepo monorepo. The desktop app lives in `packages/tauri/` (Tauri v2 + React frontend).

- Run tasks via turbo from root: `pnpm turbo run <task>` (for example `pnpm turbo run lint`, `pnpm turbo run test`)
- Or target the desktop package directly: `pnpm --filter @cadence/desktop <task>`
- Dev server: `pnpm dev` or `pnpm start` from root. Frontend/service ports are configured via `packages/tauri/.env` and `packages/service/.env` and default to `1420` / `5005`.

## Architecture

The app uses Tauri v2 as the desktop shell with a React frontend. The backend is a Rust API server in `packages/service/` spawned as a sidecar in production. In dev, `pnpm dev` from the repo root runs the service alongside the desktop app via Turborepo. The frontend communicates with the backend via HTTP (Axios) and WebSocket (Zustand store). Folder selection uses `@tauri-apps/plugin-dialog`.

Frontend path alias: `@` -> `packages/tauri/src/` (for example `import { foo } from "@/lib/foo"`).

## Critical Constraints

- Use `pnpm` instead of `npm` or `yarn`
- Lint with `pnpm run lint` (oxlint via turbo)
- Test with `pnpm test` (vitest via turbo)
- Never use `any`; use `unknown` plus narrowing when needed
- Keep TypeScript explicit. All functions, parameters, and return values must have explicit types. Prefer interfaces for object shapes and use Zod schemas for runtime validation at boundaries.
- Never swallow errors silently; surface them to the user
- Keep implementations simple and reusable; prefer extracting shared logic over duplication
- Search for existing code before writing new code. Reuse helpers, hooks, utilities, and components instead of duplicating logic.
- Avoid unnecessary re-renders, redundant network calls, and heavy main-thread work
- Do not run `pnpm orval`; `packages/tauri/src/api/generated/index.ts` is hand-maintained
- In Rust source files, keep unit tests inline with the module they cover using `#[cfg(test)]`; do not create dedicated sibling `tests.rs` files for module unit tests
- Do not spread provider-specific logic through shared frontend/backend codepaths; SDKs handle provider communication, adapters unify provider business logic, and shared code should stay provider-neutral
- No file longer than 400 lines; refactor before crossing the limit
- No function longer than 100 lines; split long functions before finishing
