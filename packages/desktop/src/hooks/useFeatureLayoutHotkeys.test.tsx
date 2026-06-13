import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFeatureLayoutHotkeys } from "./useFeatureLayoutHotkeys";

const mockUseScopedShortcut = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useShortcut", () => ({
  useShortcut: mockUseScopedShortcut,
}));

describe("useFeatureLayoutHotkeys", () => {
  it("registers the browser pane shortcut by id", () => {
    renderHook(() => useFeatureLayoutHotkeys(7, { enabled: true }));

    expect(mockUseScopedShortcut).toHaveBeenCalledWith(
      "pane-browser",
      expect.any(Function),
      expect.objectContaining({ enabled: true }),
    );
  });
});
