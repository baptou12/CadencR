import { defineConfig } from "orval";

/**
 * Generates `src/api/generated/index.ts` from the Rust OpenAPI spec.
 *
 * The spec itself is produced by the `dump-openapi` Rust binary and lives at
 * `../service/openapi.json` (gitignored — derived artifact). Run via
 * `pnpm generate:api` from `packages/tauri`.
 */
export default defineConfig({
  cadencr: {
    input: {
      target: "../service/openapi.json",
      override: {
        transformer: "./orval.transformer.cjs",
      },
    },
    output: {
      target: "./src/api/generated/index.ts",
      client: "react-query",
      mode: "single",
      override: {
        mutator: {
          path: "./src/api/client.ts",
          name: "customInstance",
        },
        query: {
          useQuery: true,
          useMutation: true,
          version: 4,
        },
      },
    },
  },
});
