import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSystemFonts } from "./useSystemFonts";
import * as mono from "./isMonospace";

function stubQueryLocalFonts(families: string[]): void {
  (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts =
    () => Promise.resolve(families.map((family) => ({ family })));
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
});

describe("useSystemFonts", () => {
  it("returns de-duplicated monospace families when showAll is false", async () => {
    stubQueryLocalFonts(["Menlo", "Menlo", "Arial", "Fira Code"]);
    vi.spyOn(mono, "isMonospace").mockImplementation((f) => f !== "Arial");

    const { result } = renderHook(() => useSystemFonts(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.fonts).toEqual(["Fira Code", "Menlo"]);
    expect(result.current.error).toBe(false);
  });

  it("returns all families when showAll is true", async () => {
    stubQueryLocalFonts(["Menlo", "Arial"]);
    const { result } = renderHook(() => useSystemFonts(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fonts).toEqual(["Arial", "Menlo"]);
  });

  it("sets error and empty list when the API is missing", async () => {
    const { result } = renderHook(() => useSystemFonts(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fonts).toEqual([]);
    expect(result.current.error).toBe(true);
  });

  it("sets error when queryLocalFonts throws", async () => {
    (window as unknown as { queryLocalFonts: () => Promise<unknown> }).queryLocalFonts = () =>
      Promise.reject(new Error("denied"));
    const { result } = renderHook(() => useSystemFonts(false));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(true);
  });
});
