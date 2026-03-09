import { Effect, Schema, ParseResult } from "effect";
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

/**
 * Query a single row and validate it against an Effect Schema at runtime.
 * Returns Effect<T | null, DatabaseError | ParseError> — callers can use
 * Effect.runSync which will throw on validation failures rather than silently
 * returning incorrectly typed data.
 */
export function queryOneValidated<T, I>(
  schema: Schema.Schema<T, I>,
  sql: string,
  ...params: unknown[]
): Effect.Effect<T | null, DatabaseError | ParseResult.ParseError> {
  const rawEffect = Effect.try({
    try: () => {
      const row = getDatabase().prepare(sql).get(...params) as unknown | undefined;
      return row ?? null;
    },
    catch: (e) => new DatabaseError({ operation: "queryOneValidated", cause: e }),
  });
  return Effect.flatMap(rawEffect, (row) =>
    row === null ? Effect.succeed(null) : Schema.decodeUnknown(schema)(row),
  );
}

/**
 * Query multiple rows and validate each against an Effect Schema at runtime.
 * Returns Effect<T[], DatabaseError | ParseError>.
 */
export function queryAllValidated<T, I>(
  schema: Schema.Schema<T, I>,
  sql: string,
  ...params: unknown[]
): Effect.Effect<T[], DatabaseError | ParseResult.ParseError> {
  const rawEffect = Effect.try({
    try: () => getDatabase().prepare(sql).all(...params) as unknown[],
    catch: (e) => new DatabaseError({ operation: "queryAllValidated", cause: e }),
  });
  return Effect.flatMap(rawEffect, (rows) =>
    Effect.all(rows.map((row) => Schema.decodeUnknown(schema)(row))),
  );
}
