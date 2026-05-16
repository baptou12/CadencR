import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearDesktopBridgeOverrideForTests,
  setDesktopBridgeOverrideForTests,
} from "@/lib/desktop-bridge";
import type { CadencrDesktopBridge } from "@/lib/desktop-bridge";
import { useZoom } from "./useZoom";

const mockSetZoom = vi.fn(() => Promise.resolve());

function bridge(): CadencrDesktopBridge {
  return {
    isElectron: true,
    runtimeConfig: vi.fn(),
    readFileBase64: vi.fn(),
    onFileDrop: vi.fn(() => () => undefined),
    revealInFinder: vi.fn(),
    openExternal: vi.fn(),
    pickDirectory: vi.fn(),
    notifyPermission: vi.fn(),
    notify: vi.fn(),
    notifyTest: vi.fn(),
    onNotificationClicked: vi.fn(() => () => undefined),
    onNotificationFailed: vi.fn(() => () => undefined),
    onNotificationFallback: vi.fn(() => () => undefined),
    onCloseRequested: vi.fn(() => () => undefined),
    confirmClose: vi.fn(),
    requestQuit: vi.fn(),
    setZoom: mockSetZoom,
    currentTheme: vi.fn(),
    onThemeChange: vi.fn(() => () => undefined),
    setBusy: vi.fn(() => Promise.resolve()),
    onPowerSuspend: vi.fn(() => () => undefined),
    onPowerResume: vi.fn(() => () => undefined),
    checkForUpdates: vi.fn(() => Promise.resolve()),
    installUpdate: vi.fn(() => Promise.resolve()),
    onUpdateEvent: vi.fn(() => () => undefined),
  };
}

const mockSetValue = vi.fn();
const mockSettingValue = { current: null as string | null };
vi.mock("./useDebouncedSetting", () => ({
  useDebouncedSetting: () => ({
    value: mockSettingValue.current,
    setValue: mockSetValue,
    isLoading: false,
  }),
}));

vi.mock("react-hotkeys-hook", () => ({
  useHotkeys: vi.fn(),
}));

describe("useZoom", () => {
  beforeEach(() => {
    mockSetZoom.mockClear();
    mockSetValue.mockClear();
    mockSettingValue.current = null;
    setDesktopBridgeOverrideForTests(bridge());
  });

  afterEach(() => clearDesktopBridgeOverrideForTests());

  it("defaults to 100% when no setting is stored", () => {
    const { result } = renderHook(() => useZoom());
    expect(result.current.zoomLevel).toBe(100);
  });

  it("reads persisted zoom level from setting", () => {
    mockSettingValue.current = "130";
    const { result } = renderHook(() => useZoom());
    expect(result.current.zoomLevel).toBe(130);
  });

  it("applies webview zoom on mount", () => {
    mockSettingValue.current = "120";
    renderHook(() => useZoom());
    expect(mockSetZoom).toHaveBeenCalledWith(1.2);
  });

  it("zoomIn increases by 10%", () => {
    mockSettingValue.current = "100";
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomIn());
    expect(mockSetValue).toHaveBeenCalledWith("110");
    expect(mockSetZoom).toHaveBeenCalledWith(1.1);
  });

  it("zoomOut decreases by 10%", () => {
    mockSettingValue.current = "100";
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomOut());
    expect(mockSetValue).toHaveBeenCalledWith("90");
    expect(mockSetZoom).toHaveBeenCalledWith(0.9);
  });

  it("resetZoom sets to 100%", () => {
    mockSettingValue.current = "150";
    const { result } = renderHook(() => useZoom());
    act(() => result.current.resetZoom());
    expect(mockSetValue).toHaveBeenCalledWith("100");
    expect(mockSetZoom).toHaveBeenCalledWith(1.0);
  });

  it("clamps zoom to minimum 50%", () => {
    mockSettingValue.current = "50";
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomOut());
    expect(mockSetValue).toHaveBeenCalledWith("50");
  });

  it("clamps zoom to maximum 200%", () => {
    mockSettingValue.current = "200";
    const { result } = renderHook(() => useZoom());
    act(() => result.current.zoomIn());
    expect(mockSetValue).toHaveBeenCalledWith("200");
  });

  it("setZoom applies arbitrary clamped value", () => {
    const { result } = renderHook(() => useZoom());
    act(() => result.current.setZoom(75));
    expect(mockSetValue).toHaveBeenCalledWith("75");
    expect(mockSetZoom).toHaveBeenCalledWith(0.75);
  });
});
