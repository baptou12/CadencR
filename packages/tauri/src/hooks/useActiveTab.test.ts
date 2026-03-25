import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockSetValue = vi.fn();
let mockValue: string | null = null;

vi.mock("./useDebouncedSetting", () => ({
  useDebouncedSetting: () => ({ value: mockValue, setValue: mockSetValue, isLoading: false }),
}));

import { useActiveTab } from "./useActiveTab";

describe("useActiveTab", () => {
  beforeEach(() => {
    mockValue = null;
    mockSetValue.mockClear();
  });

  it("defaults to agent when no saved value", () => {
    const { result } = renderHook(() => useActiveTab(1));
    expect(result.current.activeTab).toBe("agent");
  });

  it("returns saved tab when valid", () => {
    mockValue = "terminal";
    const { result } = renderHook(() => useActiveTab(1));
    expect(result.current.activeTab).toBe("terminal");
  });

  it("returns agent for invalid saved value", () => {
    mockValue = "invalid-tab";
    const { result } = renderHook(() => useActiveTab(1));
    expect(result.current.activeTab).toBe("agent");
  });

  it("calls setValue when setActiveTab is called", () => {
    const { result } = renderHook(() => useActiveTab(1));
    act(() => result.current.setActiveTab("git"));
    expect(mockSetValue).toHaveBeenCalledWith("git");
  });
});
