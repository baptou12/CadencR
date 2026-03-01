/**
 * SDK Client abstraction — wraps @anthropic-ai/claude-agent-sdk so that
 * subprocess-manager can be tested with a mock implementation.
 *
 * Default implementation dynamically imports the real SDK.
 * Tests can call `setSdkClient()` to inject a mock.
 */

/** Minimal interface for the SDK Query object used by subprocess-manager. */
export interface SdkQuery {
  /** Async iterator that yields SDK messages */
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  /** Interrupt the running query (pause) */
  interrupt(): Promise<void>;
  /** Close the query and subprocess */
  close(): void;
  /** Set permission mode */
  setPermissionMode(mode: "acceptEdits" | "plan"): Promise<void>;
  /** Get supported slash commands */
  supportedCommands(): Promise<unknown[]>;
}

export interface SdkQueryOptions {
  prompt: string | AsyncIterable<unknown>;
  options?: Record<string, unknown>;
}

export interface SdkClient {
  /** Create a new SDK query */
  query(opts: SdkQueryOptions): SdkQuery;
}

// ---------------------------------------------------------------------------
// Default implementation — real SDK (lazy-loaded to allow test mocking)
// ---------------------------------------------------------------------------

let cachedSdk: SdkClient | null = null;
let customClient: SdkClient | null = null;

/**
 * Get the SDK client. Uses the custom client if set, otherwise lazily loads the real SDK.
 */
export async function getSdkClient(): Promise<SdkClient> {
  if (customClient) return customClient;
  if (cachedSdk) return cachedSdk;

  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  cachedSdk = {
    query: (opts: SdkQueryOptions) =>
      (sdk as unknown as { query: (opts: SdkQueryOptions) => SdkQuery }).query(opts),
  };
  return cachedSdk;
}

/**
 * Inject a custom SDK client (for testing).
 * Pass `null` to reset to the real SDK.
 */
export function setSdkClient(client: SdkClient | null): void {
  customClient = client;
}
