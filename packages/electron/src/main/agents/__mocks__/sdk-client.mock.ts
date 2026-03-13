/**
 * Reusable mock factory for the Claude Agent SDK client.
 * Does NOT import the real SDK — safe for tests without token burn.
 *
 * Usage:
 *   const { client, emitMessage, complete } = createMockSdkClient();
 *   setSdkClient(client);
 *   // ... start subprocess or call query ...
 *   emitMessage({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } });
 *   complete();
 */

import type { SdkClient, SdkQuery, SdkQueryOptions } from "../sdk-client";

interface MockQueryHandle {
  /** Push a message into the async iterator */
  emitMessage: (msg: unknown) => void;
  /** End the async iteration (signal query completion) */
  complete: () => void;
  /** The options passed to query() */
  options: SdkQueryOptions;
  /** The SdkQuery object returned to the caller */
  query: SdkQuery;
}

export interface MockSdkClient {
  /** The SdkClient to inject via setSdkClient() */
  client: SdkClient;
  /** Push a message to the most recent query's async iterator */
  emitMessage: (msg: unknown) => void;
  /** Complete the most recent query's async iteration */
  complete: () => void;
  /** Get all query handles created so far */
  getQueries: () => MockQueryHandle[];
}

export function createMockSdkClient(): MockSdkClient {
  const queries: MockQueryHandle[] = [];

  const client: SdkClient = {
    query(opts: SdkQueryOptions): SdkQuery {
      // Create a push-based async iterable
      const buffer: unknown[] = [];
      let resolve: ((value: IteratorResult<unknown>) => void) | null = null;
      let done = false;

      const emitMessage = (msg: unknown) => {
        if (done) return;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: msg, done: false });
        } else {
          buffer.push(msg);
        }
      };

      const complete = () => {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined, done: true });
        }
      };

      const query: SdkQuery = {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<unknown>> {
              if (buffer.length > 0) {
                return Promise.resolve({ value: buffer.shift()!, done: false });
              }
              if (done) {
                return Promise.resolve({ value: undefined, done: true });
              }
              return new Promise((r) => {
                resolve = r;
              });
            },
          };
        },
        interrupt: async () => {},
        close: () => {
          complete();
        },
        setPermissionMode: async () => {},
        supportedCommands: async () => [],
      };

      const handle: MockQueryHandle = { emitMessage, complete, options: opts, query };
      queries.push(handle);
      return query;
    },
  };

  return {
    client,
    emitMessage: (msg: unknown) => {
      const last = queries[queries.length - 1];
      if (!last) throw new Error("No query created yet");
      last.emitMessage(msg);
    },
    complete: () => {
      const last = queries[queries.length - 1];
      if (!last) throw new Error("No query created yet");
      last.complete();
    },
    getQueries: () => queries,
  };
}
