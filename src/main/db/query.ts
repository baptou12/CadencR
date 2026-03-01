import { Option, Result } from "@swan-io/boxed";
import { getDatabase } from "./database";

/** Query a single row, returning Option<T> instead of T | undefined */
export function queryOne<T>(sql: string, ...params: unknown[]): Option<T> {
  const row = getDatabase().prepare(sql).get(...params) as T | undefined;
  return Option.fromNullable(row);
}

/** Query multiple rows, catching DB errors */
export function queryAll<T>(sql: string, ...params: unknown[]): Result<T[], Error> {
  return Result.fromExecution(() => {
    return getDatabase().prepare(sql).all(...params) as T[];
  });
}

/** Run a mutation, returning Result with the run outcome */
export function execute(
  sql: string,
  ...params: unknown[]
): Result<{ changes: number; lastInsertRowid: number }, Error> {
  return Result.fromExecution(() => {
    const r = getDatabase().prepare(sql).run(...params);
    return { changes: r.changes as number, lastInsertRowid: Number(r.lastInsertRowid) };
  });
}
