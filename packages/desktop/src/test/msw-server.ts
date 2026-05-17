// MSW server for vitest. A single catch-all handler intercepts every HTTP
// request fired by tests so unmocked React Query hooks resolve instead of
// throwing `AxiosError: Network Error`. Tests that need a specific response
// shape continue to mock at the hook layer (`vi.mock("@/api/generated", ...)`);
// hook-level mocks short-circuit before the request, so MSW only catches the
// long tail of unmocked hooks.

import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Scoped to the dev backend base URL (matches `DEFAULT_DEV_BASE_URL` in
// `src/api/client.ts`). Tests never override `VITE_API_URL`, so every axios
// call goes through this host. Keeping the matcher narrow means an accidental
// fetch to a different host (CDN, analytics, real network) still fails loudly
// instead of being silently swallowed.
export const server = setupServer(
  http.all("http://127.0.0.1:5005/*", () => HttpResponse.json({}, { status: 200 })),
);
