import { Context, Effect, Layer, Schema, ParseResult } from "effect";
import { DatabaseError } from "../errors.js";
import { getDatabase } from "../../db/database.js";

/** Effect-based interface for database operations */
export interface DatabaseService {
  queryOne: <T>(sql: string, ...params: unknown[]) => Effect.Effect<T | null, DatabaseError>;
  queryAll: <T>(sql: string, ...params: unknown[]) => Effect.Effect<T[], DatabaseError>;
  execute: (
    sql: string,
    ...params: unknown[]
  ) => Effect.Effect<{ changes: number; lastInsertRowid: number }, DatabaseError>;
  /** Query a single row and validate it against an Effect Schema at runtime */
  queryOneValidated: <T, I>(
    schema: Schema.Schema<T, I>,
    sql: string,
    ...params: unknown[]
  ) => Effect.Effect<T | null, DatabaseError | ParseResult.ParseError>;
  /** Query multiple rows and validate each against an Effect Schema at runtime */
  queryAllValidated: <T, I>(
    schema: Schema.Schema<T, I>,
    sql: string,
    ...params: unknown[]
  ) => Effect.Effect<T[], DatabaseError | ParseResult.ParseError>;
}

/** Context tag for the Database service */
export class Database extends Context.Tag("Database")<Database, DatabaseService>() {}

/** Live implementation using better-sqlite3 (synchronous) */
export const DatabaseLive = Layer.sync(Database, () => ({
  queryOne: <T>(sql: string, ...params: unknown[]): Effect.Effect<T | null, DatabaseError> =>
    Effect.try({
      try: () => {
        const row = getDatabase().prepare(sql).get(...params) as T | undefined;
        return row ?? null;
      },
      catch: (e) => new DatabaseError({ operation: "queryOne", cause: e }),
    }),

  queryAll: <T>(sql: string, ...params: unknown[]): Effect.Effect<T[], DatabaseError> =>
    Effect.try({
      try: () => getDatabase().prepare(sql).all(...params) as T[],
      catch: (e) => new DatabaseError({ operation: "queryAll", cause: e }),
    }),

  execute: (
    sql: string,
    ...params: unknown[]
  ): Effect.Effect<{ changes: number; lastInsertRowid: number }, DatabaseError> =>
    Effect.try({
      try: () => {
        const r = getDatabase().prepare(sql).run(...params);
        return { changes: r.changes as number, lastInsertRowid: Number(r.lastInsertRowid) };
      },
      catch: (e) => new DatabaseError({ operation: "execute", cause: e }),
    }),

  queryOneValidated: <T, I>(
    schema: Schema.Schema<T, I>,
    sql: string,
    ...params: unknown[]
  ): Effect.Effect<T | null, DatabaseError | ParseResult.ParseError> => {
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
  },

  queryAllValidated: <T, I>(
    schema: Schema.Schema<T, I>,
    sql: string,
    ...params: unknown[]
  ): Effect.Effect<T[], DatabaseError | ParseResult.ParseError> => {
    const rawEffect = Effect.try({
      try: () => getDatabase().prepare(sql).all(...params) as unknown[],
      catch: (e) => new DatabaseError({ operation: "queryAllValidated", cause: e }),
    });
    return Effect.flatMap(rawEffect, (rows) =>
      Effect.all(rows.map((row) => Schema.decodeUnknown(schema)(row))),
    );
  },
}));
