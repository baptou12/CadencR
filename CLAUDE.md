# CLAUDE.md

## Critical Constraints

- Do NOT upgrade tRPC beyond v10 or React Query beyond v4 — `electron-trpc` requires these exact major versions
- Use `pnpm` (not npm/yarn)
- Lint with `pnpm run lint` (oxlint), test with `pnpm test` (vitest)
