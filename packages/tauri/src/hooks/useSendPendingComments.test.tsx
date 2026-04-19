import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => {
  const mutateAsync = vi.fn();
  const useDeletePendingDiffComments = vi.fn(() => ({ mutateAsync }));
  const toastError = vi.fn();
  return { mutateAsync, useDeletePendingDiffComments, toastError };
});

vi.mock("@/api/generated", () => ({
  useDeletePendingDiffComments: mocks.useDeletePendingDiffComments,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

import {
  useSendPendingComments,
  type PendingDiffComment,
} from "./useSendPendingComments";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const sampleComments: PendingDiffComment[] = [
  { file_path: "src/a.ts", line_number: 1, content: "fix this" },
  { file_path: "src/a.ts", line_number: 4, content: "and this" },
];

describe("useSendPendingComments", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.toastError.mockReset();
  });

  it("disables + hides when there are no comments", () => {
    const { result } = renderHook(
      () => useSendPendingComments({ featureId: 1, pendingComments: [], onSend: vi.fn() }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.disabled).toBe(true);
    expect(result.current.shouldRender).toBe(false);
    expect(result.current.buttonLabel).toBe("Send 0 comments");
  });

  it("uses the provided verb in the button label", () => {
    const { result } = renderHook(
      () =>
        useSendPendingComments({
          featureId: 1,
          pendingComments: sampleComments,
          onSend: vi.fn(),
          verb: "Fix",
        }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.buttonLabel).toBe("Fix 2 comments");
    expect(result.current.shouldRender).toBe(true);
    expect(result.current.disabled).toBe(false);
  });

  it("is inert when onSend is omitted", async () => {
    const { result } = renderHook(
      () => useSendPendingComments({ featureId: 1, pendingComments: sampleComments }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.disabled).toBe(true);
    expect(result.current.shouldRender).toBe(false);
    await act(async () => {
      await result.current.send();
    });
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });

  it("awaits deletePending before invoking onSend + onAfterSend", async () => {
    const events: string[] = [];
    let resolveDelete!: () => void;
    mocks.mutateAsync.mockImplementation(
      () =>
        new Promise<{ deleted: number }>((resolve) => {
          events.push("delete:start");
          resolveDelete = () => {
            events.push("delete:resolve");
            resolve({ deleted: 2 });
          };
        }),
    );
    const onSend = vi.fn(() => events.push("send"));
    const onAfterSend = vi.fn(() => events.push("afterSend"));

    const { result } = renderHook(
      () =>
        useSendPendingComments({
          featureId: 7,
          pendingComments: sampleComments,
          onSend,
          onAfterSend,
        }),
      { wrapper: makeWrapper() },
    );

    let sendPromise!: Promise<void>;
    act(() => {
      sendPromise = result.current.send();
    });
    await waitFor(() => expect(events).toContain("delete:start"));
    expect(onSend).not.toHaveBeenCalled();
    resolveDelete();
    await act(async () => {
      await sendPromise;
    });

    expect(events).toEqual(["delete:start", "delete:resolve", "send", "afterSend"]);
    expect(onSend).toHaveBeenCalledWith(expect.stringContaining("src/a.ts"));
    expect(result.current.sending).toBe(false);
  });

  it("surfaces errors via toast and clears sending state", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("boom"));
    const onSend = vi.fn();
    const onAfterSend = vi.fn();
    const { result } = renderHook(
      () =>
        useSendPendingComments({
          featureId: 1,
          pendingComments: sampleComments,
          onSend,
          onAfterSend,
        }),
      { wrapper: makeWrapper() },
    );
    await act(async () => {
      await result.current.send();
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(onAfterSend).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledWith("Failed to send comments");
    expect(result.current.sending).toBe(false);
  });

  it("does nothing when already sending", async () => {
    let resolveDelete!: () => void;
    mocks.mutateAsync.mockImplementation(
      () => new Promise<{ deleted: number }>((resolve) => { resolveDelete = () => resolve({ deleted: 2 }); }),
    );
    const onSend = vi.fn();
    const { result } = renderHook(
      () => useSendPendingComments({ featureId: 1, pendingComments: sampleComments, onSend }),
      { wrapper: makeWrapper() },
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.send();
    });
    await waitFor(() => expect(result.current.sending).toBe(true));
    await act(async () => {
      await result.current.send(); // no-op while sending
    });
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    resolveDelete();
    await act(async () => {
      await first;
    });
  });
});
