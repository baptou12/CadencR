// MSW server for vitest. A single catch-all handler intercepts every HTTP
// request fired by tests so unmocked React Query hooks resolve instead of
// throwing `AxiosError: Network Error`. Tests that need a specific response
// shape continue to mock at the hook layer (`vi.mock("@/api/generated", ...)`);
// hook-level mocks short-circuit before the request, so MSW only catches the
// long tail of unmocked hooks.

import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

// Scoped to the dev backend base URL, resolved exactly the way `src/api/client.ts`
// resolves it: `VITE_API_URL` when set, else `DEFAULT_DEV_BASE_URL`. Hardcoding
// :5005 here silently stopped intercepting in any worktree whose `.env` picks a
// different port — axios then hit the real network and unmocked hooks failed.
// Keeping the matcher narrow (one host) means an accidental fetch elsewhere
// (CDN, analytics, real network) still fails loudly instead of being swallowed.
export const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:5005").replace(
  /\/$/,
  "",
);

export const server = setupServer(
  http.all(`${API_BASE_URL}/*`, () => HttpResponse.json({}, { status: 200 })),
);
