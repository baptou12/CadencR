---
paths:
  - "packages/electron/src/main/**"
---

The database layer now uses Effect (`src/main/effect`) instead of `@swan-io/boxed`. When touching any backend file:

- Use `queryOne<T>()` from `src/main/db/query.ts` — returns `Effect.Effect<T | null, DatabaseError>`. Unwrap with `Effect.runSync(queryOne(...))`.
- Use `queryAll<T>()` — returns `Effect.Effect<T[], DatabaseError>`. Unwrap with `Effect.runSync(queryAll(...))`.
- Use `execute()` for mutations — returns `Effect.Effect<{ changes; lastInsertRowid }, DatabaseError>`. Unwrap with `Effect.runSync(execute(...))`.
- Replace `queryOne().toNull()` with `Effect.runSync(queryOne(...))` (returns `T | null`).
- Replace `queryOne().isSome()` with `Effect.runSync(queryOne(...)) !== null`.
- Replace `queryOne().match({ None: ..., Some: ... })` with `const v = Effect.runSync(queryOne(...)); return v !== null ? someCase(v) : noneCase();`.
- Replace `queryAll().getOr([])` with `Effect.runSync(queryAll(...))`.
- Replace `execute().match({ Ok: ..., Error: ... })` with try/catch around `Effect.runSync(execute(...))`.
- Never use `@swan-io/boxed` for new code — the Boxed dependency is being phased out.
- See `src/main/trpc/features.ts` as the reference migration.
