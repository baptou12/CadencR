# Contributing

## Local Development

1. Copy `packages/service/.env.example` to `packages/service/.env`.
2. Copy `packages/tauri/.env.example` to `packages/tauri/.env`.
3. Set corresponding local values in both files.
4. Run `pnpm install`.
5. Run `pnpm dev`.

Each package reads only its own local `.env` file, and missing required files or keys fail fast during dev startup.

If you need different ports or a custom DB path, set these in the package env files:

- `packages/service/.env`: `CADENCE_FRONTEND_PORT`, `CADENCE_RUST_PORT`, `CADENCE_DB_PATH`
- `packages/tauri/.env`: `VITE_API_TOKEN`, `VITE_FRONTEND_PORT`, `VITE_API_URL`

Keep these values aligned manually:

- `CADENCE_AUTH_TOKEN` and `VITE_API_TOKEN`
- `CADENCE_FRONTEND_PORT` and `VITE_FRONTEND_PORT`
- `CADENCE_RUST_PORT` and the port used in `VITE_API_URL`

## Common Commands

```bash
pnpm dev
pnpm start
pnpm test
pnpm run lint
```

## Conventions

- Use `pnpm`, not `npm` or `yarn`.
- Keep TypeScript explicit and do not introduce `any`.
- Keep Rust unit tests inline with the module they cover.
- Do not run `pnpm orval`; `packages/tauri/src/api/generated/index.ts` is hand-maintained.

## Notes

- Only publish reviewed branches.
- `packages/*/.env` files are local-only and should never be committed.
- Agent-facing docs live in `AGENTS.md`, but `README.md` and this file are the contributor entrypoints.
