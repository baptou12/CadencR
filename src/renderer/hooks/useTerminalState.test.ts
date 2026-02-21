import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { useTerminalState, useTerminalStore } from "./useTerminalState";

describe("useTerminalState", () => {
  beforeEach(() => {
    // Reset the store between tests
    useTerminalStore.setState({ features: {} });
  });

  it("starts with panel closed and no panes", () => {
    const { result } = renderHook(() => useTerminalState(1));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(false);
    expect(result.current.panes).toEqual([]);
  });

  it("togglePanel opens panel with a new pane when closed", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.panes).toHaveLength(1);
  });

  it("togglePanel closes panel when open", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    act(() => {
      result.current.togglePanel();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("addPane adds a pane", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    act(() => {
      result.current.addPane();
    });
    expect(result.current.panes).toHaveLength(2);
  });

  it("removePane removes a pane by id", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    const paneId = result.current.panes[0].id;
    act(() => {
      result.current.removePane(paneId);
    });
    expect(result.current.panes).toHaveLength(0);
    expect(result.current.isOpen).toBe(false);
  });

  it("removePane closes panel when last pane removed", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    const paneId = result.current.panes[0].id;
    act(() => {
      result.current.removePane(paneId);
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("minimize sets isMinimized", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    act(() => {
      result.current.minimize();
    });
    expect(result.current.isMinimized).toBe(true);
    expect(result.current.isOpen).toBe(true);
  });

  it("closePanel clears all state", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    act(() => {
      result.current.addPane();
    });
    act(() => {
      result.current.closePanel();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.panes).toHaveLength(0);
  });

  it("state is isolated per featureId", () => {
    const { result: r1 } = renderHook(() => useTerminalState(1));
    const { result: r2 } = renderHook(() => useTerminalState(2));

    act(() => {
      r1.current.togglePanel();
    });

    expect(r1.current.isOpen).toBe(true);
    expect(r2.current.isOpen).toBe(false);
  });

  it("setPtyId associates ptyId with a pane", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => {
      result.current.togglePanel();
    });
    const paneId = result.current.panes[0].id;
    act(() => {
      useTerminalStore.getState().setPtyId(1, paneId, "pty-123");
    });
    const pane = useTerminalStore.getState().features[1].panes.find((p) => p.id === paneId);
    expect(pane?.ptyId).toBe("pty-123");
  });
});
