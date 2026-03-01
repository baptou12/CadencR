---
paths:
  - "src/main/**"
---

We are incrementally migrating the backend to use `@swan-io/boxed` (`Option`, `Result`, `Future`) for safer data handling. When touching any backend file:

- Use `queryOne<T>()` from `src/main/db/query.ts` instead of raw `.get() as T | undefined`. It returns `Option<T>`.
- Use `queryAll<T>()` instead of raw `.all() as T[]`. It returns `Result<T[], Error>`.
- Use `execute()` instead of raw `.run()` for mutations when you need the result. It returns `Result`.
- Replace `if (!row) throw new Error(...)` with `queryOne().toResult("msg")`.
- Replace `if (row) doSomething(row)` with `queryOne().tapSome(...)`.
- Replace `row?.field ?? fallback` with `queryOne().map(r => r.field).getOr(fallback)`.
- Unwrap Boxed types at tRPC boundaries (`.toNull()`, `.getOr()`, `.match()`) — never return raw `Option`/`Result` over IPC.
- See `src/main/trpc/features.ts` as the reference migration.
