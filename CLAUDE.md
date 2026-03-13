# CLAUDE.md

## Monorepo Structure

This is a pnpm workspaces + Turborepo monorepo. Source code lives in `packages/electron/`.

- Run tasks via turbo from root: `pnpm turbo run <task>` (e.g., `pnpm turbo run lint`, `pnpm turbo run test`)
- Or target the electron package directly: `pnpm --filter @cadence/electron <task>`
- Dev server: `pnpm dev` or `pnpm start` from root

## Critical Constraints

- Do NOT upgrade tRPC beyond v10 or React Query beyond v4 — `electron-trpc` requires these exact major versions
- Use `pnpm` (not npm/yarn)
- Lint with `pnpm run lint` (oxlint via turbo), test with `pnpm test` (vitest via turbo)
