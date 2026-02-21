/**
 * Shared test utilities for renderer tests.
 * Provides custom render with all required providers, mock factories,
 * and helpers for tRPC, Electron IPC, and TanStack Router.
 */
import React from "react";
import { render as rtlRender, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { createRootRoute, createRoute, Outlet } from "@tanstack/react-router";
import { trpc } from "@/trpc";
import { httpBatchLink } from "@trpc/client";
import { vi } from "vitest";

// Re-export everything from testing-library
export * from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock tRPC client
// ---------------------------------------------------------------------------

/**
 * Creates a mock tRPC client that uses a no-op HTTP link.
 * Individual queries/mutations should be mocked at the component level
 * by overriding the QueryClient cache or using vi.spyOn on trpc hooks.
 */
export function createMockTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "http://localhost:3000/trpc",
        fetch: async () => {
          return new Response(JSON.stringify([{ result: { data: null } }]), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
}

/**
 * Creates a fresh QueryClient suitable for tests (no retries, no cache time).
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        cacheTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Mock Electron window.api
// ---------------------------------------------------------------------------

export interface MockElectronApi {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  invoke: ReturnType<typeof vi.fn>;
}

/**
 * Mocks window.api (the Electron preload bridge) with vi.fn() stubs.
 * Call this in beforeEach or at the top of a test. Returns the mock for assertions.
 */
export function mockElectronApi(): MockElectronApi {
  const api: MockElectronApi = {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    invoke: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(window, "api", {
    value: api,
    writable: true,
    configurable: true,
  });
  return api;
}

// ---------------------------------------------------------------------------
// IPC helpers
// ---------------------------------------------------------------------------

/**
 * Returns a helper that simulates an IPC event being emitted.
 * Usage: const emit = mockIpcOn(); emit('db:updated', { ... });
 */
export function mockIpcOn() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  const on = vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    const arr = listeners.get(channel) ?? [];
    arr.push(listener);
    listeners.set(channel, arr);
  });

  const off = vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    const arr = listeners.get(channel) ?? [];
    listeners.set(channel, arr.filter((l) => l !== listener));
  });

  Object.defineProperty(window, "api", {
    value: { on, off, send: vi.fn(), invoke: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });

  const emit = (channel: string, ...args: unknown[]) => {
    const arr = listeners.get(channel) ?? [];
    arr.forEach((l) => l(...args));
  };

  return { on, off, emit, listeners };
}

/**
 * Alias for cleanup — call in afterEach to remove IPC mocks.
 */
export function mockIpcOff() {
  // Restore window.api to undefined after test
  Object.defineProperty(window, "api", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ---------------------------------------------------------------------------
// Minimal router for testing
// ---------------------------------------------------------------------------

function createTestRouter() {
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <div data-testid="test-route-outlet" />,
  });

  const routeTree = rootRoute.addChildren([indexRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

// ---------------------------------------------------------------------------
// Custom render
// ---------------------------------------------------------------------------

interface CustomRenderOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

function AllProviders({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  const [trpcClient] = React.useState(() => createMockTrpcClient());
  const router = React.useMemo(() => createTestRouter(), []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} defaultComponent={() => <>{children}</>} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

/**
 * Custom render that wraps children in tRPC, QueryClient, and Router providers.
 * A fresh QueryClient is created per call unless one is provided.
 */
export function render(ui: React.ReactElement, options: CustomRenderOptions = {}) {
  const { queryClient = createTestQueryClient(), ...renderOptions } = options;

  function Wrapper({ children }: { children: React.ReactNode }) {
    const [trpcClient] = React.useState(() => createMockTrpcClient());
    return (
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </trpc.Provider>
    );
  }

  return rtlRender(ui, { wrapper: Wrapper, ...renderOptions });
}
