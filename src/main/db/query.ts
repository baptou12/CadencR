import { Effect } from "effect";
import { DatabaseError } from "../effect/errors.js";
import { getDatabase } from "./database.js";

/** Query a single row, returning Effect<T | null, DatabaseError> */
export function queryOne<T>(sql: string, ...params: unknown[]): Effect.Effect<T | null, DatabaseError> {
  return Effect.try({
    try: () => {
      const row = getDatabase().prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    catch: (e) => new DatabaseError({ operation: "queryOne", cause: e }),
  });
}

/** Query multiple rows, returning Effect<T[], DatabaseError> */
export function queryAll<T>(sql: string, ...params: unknown[]): Effect.Effect<T[], DatabaseError> {
  return Effect.try({
    try: () => getDatabase().prepare(sql).all(...params) as T[],
    catch: (e) => new DatabaseError({ operation: "queryAll", cause: e }),
  });
}

/** Run a mutation, returning Effect<{ changes; lastInsertRowid }, DatabaseError> */
export function execute(
  sql: string,
  ...params: unknown[]
): Effect.Effect<{ changes: number; lastInsertRowid: number }, DatabaseError> {
  return Effect.try({
    try: () => {
      const r = getDatabase().prepare(sql).run(...params);
      return { changes: r.changes as number, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    catch: (e) => new DatabaseError({ operation: "execute", cause: e }),
  });
}
