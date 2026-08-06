import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useSystemFonts } from "./useSystemFonts";
import * as mono from "./isMonospace";

function stubQueryLocalFonts(families: string[]): void {
  window.queryLocalFonts = () => Promise.resolve(families.map((family) => ({ family })));
}

afterEach(() => {
  vi.restoreAllMocks();
  delete window.queryLocalFonts;
});

describe("useSystemFonts", () => {
  it("does not query on mount", () => {
    stubQueryLocalFonts(["Menlo"]);
    const { result } = renderHook(() => useSystemFonts());
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fonts).toEqual([]);
  });

  it("returns de-duplicated monospace families when showAll is false", async () => {
    stubQueryLocalFonts(["Menlo", "Menlo", "Arial", "Fira Code"]);
    vi.spyOn(mono, "isMonospace").mockImplementation((f) => f !== "Arial");

    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.fonts).toEqual(["Fira Code", "Menlo"]);
    expect(result.current.error).toBe(false);
  });

  it("returns all families when showAll is true", async () => {
    stubQueryLocalFonts(["Menlo", "Arial"]);
    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fonts).toEqual(["Arial", "Menlo"]);
  });

  it("sets error and empty list when the API is missing", async () => {
    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fonts).toEqual([]);
    expect(result.current.error).toBe(true);
  });

  it("sets error when queryLocalFonts throws asynchronously", async () => {
    window.queryLocalFonts = () => Promise.reject(new Error("denied"));
    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(true);
  });

  it("sets error when queryLocalFonts throws synchronously", async () => {
    window.queryLocalFonts = () => {
      throw new Error("Illegal invocation");
    };
    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(true);
  });

  it("uses the window receiver when invoking queryLocalFonts", async () => {
    let receiver: unknown;
    window.queryLocalFonts = function queryLocalFonts(this: Window) {
      receiver = this;
      return Promise.resolve([]);
    };
    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(receiver).toBe(window);
  });

  it("sets error and empty list when entries are malformed", async () => {
    window.queryLocalFonts = () => Promise.resolve([{ family: 42 }] as never);
    const { result } = renderHook(() => useSystemFonts());
    act(() => result.current.load(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fonts).toEqual([]);
    expect(result.current.error).toBe(true);
  });
});
