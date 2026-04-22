import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import {
  useTerminalState,
  useTerminalStore,
  getLeaves,
  findAdjacentLeaf,
  type SplitNode,
  type TerminalLeaf,
} from "./useTerminalState";

describe("useTerminalState", () => {
  beforeEach(() => {
    useTerminalStore.setState({ features: {} });
  });

  it("starts with panel closed and no panes", () => {
    const { result } = renderHook(() => useTerminalState(1));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.isMinimized).toBe(false);
    expect(result.current.panes).toEqual([]);
    expect(result.current.root).toBeNull();
  });

  it("togglePanel opens panel with a new pane when closed", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.panes).toHaveLength(1);
    expect(result.current.root?.type).toBe("leaf");
  });

  it("togglePanel closes panel when open", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    act(() => result.current.togglePanel());
    expect(result.current.isOpen).toBe(false);
  });

  it("addPane adds a pane via horizontal split", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    act(() => result.current.addPane());
    expect(result.current.panes).toHaveLength(2);
    expect(result.current.root?.type).toBe("split");
  });

  it("splitPane creates a vertical split (stacked)", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    const leafId = result.current.panes[0].id;
    act(() => result.current.splitPane(leafId, "vertical"));
    expect(result.current.panes).toHaveLength(2);
    const root = result.current.root;
    expect(root?.type).toBe("split");
    if (root?.type === "split") {
      expect(root.orientation).toBe("vertical");
    }
  });

  it("splitPane supports mixed orientations", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    const firstId = result.current.panes[0].id;
    // Split first pane horizontally (side-by-side)
    act(() => result.current.splitPane(firstId, "horizontal"));
    expect(result.current.panes).toHaveLength(2);
    // Now split the second pane vertically (stacked)
    const secondId = result.current.panes[1].id;
    act(() => result.current.splitPane(secondId, "vertical"));
    expect(result.current.panes).toHaveLength(3);
    // Root should be horizontal, right child should be vertical
    const root = result.current.root;
    expect(root?.type).toBe("split");
    if (root?.type === "split") {
      expect(root.orientation).toBe("horizontal");
      expect(root.children[0].type).toBe("leaf");
      expect(root.children[1].type).toBe("split");
      if (root.children[1].type === "split") {
        expect(root.children[1].orientation).toBe("vertical");
      }
    }
  });

  it("removePane removes a pane by id", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    const paneId = result.current.panes[0].id;
    act(() => result.current.removePane(paneId));
    expect(result.current.panes).toHaveLength(0);
    expect(result.current.isOpen).toBe(false);
  });

  it("removePane collapses split when one child removed", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    act(() => result.current.addPane());
    expect(result.current.panes).toHaveLength(2);
    const firstId = result.current.panes[0].id;
    act(() => result.current.removePane(firstId));
    expect(result.current.panes).toHaveLength(1);
    // Tree should collapse back to a single leaf
    expect(result.current.root?.type).toBe("leaf");
  });

  it("removePane closes panel when last pane removed", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    const paneId = result.current.panes[0].id;
    act(() => result.current.removePane(paneId));
    expect(result.current.isOpen).toBe(false);
  });

  it("minimize sets isMinimized", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    act(() => result.current.minimize());
    expect(result.current.isMinimized).toBe(true);
    expect(result.current.isOpen).toBe(true);
  });

  it("closePanel clears all state", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    act(() => result.current.addPane());
    act(() => result.current.closePanel());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.panes).toHaveLength(0);
  });

  it("state is isolated per featureId", () => {
    const { result: r1 } = renderHook(() => useTerminalState(1));
    const { result: r2 } = renderHook(() => useTerminalState(2));
    act(() => r1.current.togglePanel());
    expect(r1.current.isOpen).toBe(true);
    expect(r2.current.isOpen).toBe(false);
  });

  it("setPtyId associates ptyId with a pane", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    const paneId = result.current.panes[0].id;
    act(() => useTerminalStore.getState().setPtyId(1, paneId, "pty-123"));
    const root = useTerminalStore.getState().features[1].root;
    expect(root?.type).toBe("leaf");
    if (root?.type === "leaf") {
      expect(root.ptyId).toBe("pty-123");
    }
  });

  // Helper to build leaf nodes for navigation tests
  const leaf = (id: string): TerminalLeaf => ({ type: "leaf", id });

  it("getLeaves returns leaves in DFS order", () => {
    const { result } = renderHook(() => useTerminalState(1));
    act(() => result.current.togglePanel());
    const firstId = result.current.panes[0].id;
    act(() => result.current.splitPane(firstId, "horizontal"));
    const secondId = result.current.panes[1].id;
    act(() => result.current.splitPane(secondId, "vertical"));

    const root = result.current.root!;
    const leaves = getLeaves(root);
    expect(leaves).toHaveLength(3);
    expect(leaves[0].id).toBe(firstId);
    expect(leaves[1].id).toBe(secondId);
  });

  describe("findAdjacentLeaf", () => {
    it("returns null for a single leaf (no neighbors)", () => {
      const root = leaf("A");
      expect(findAdjacentLeaf(root, "A", "left")).toBeNull();
      expect(findAdjacentLeaf(root, "A", "right")).toBeNull();
      expect(findAdjacentLeaf(root, "A", "up")).toBeNull();
      expect(findAdjacentLeaf(root, "A", "down")).toBeNull();
    });

    it("navigates left/right in a horizontal split", () => {
      // [A | B]
      const root: SplitNode = {
        type: "split",
        orientation: "horizontal",
        children: [leaf("A"), leaf("B")],
      };
      expect(findAdjacentLeaf(root, "A", "right")).toBe("B");
      expect(findAdjacentLeaf(root, "B", "left")).toBe("A");
      expect(findAdjacentLeaf(root, "A", "left")).toBeNull();
      expect(findAdjacentLeaf(root, "B", "right")).toBeNull();
    });

    it("navigates up/down in a vertical split", () => {
      // [A / B] (top/bottom)
      const root: SplitNode = {
        type: "split",
        orientation: "vertical",
        children: [leaf("A"), leaf("B")],
      };
      expect(findAdjacentLeaf(root, "A", "down")).toBe("B");
      expect(findAdjacentLeaf(root, "B", "up")).toBe("A");
      expect(findAdjacentLeaf(root, "A", "up")).toBeNull();
      expect(findAdjacentLeaf(root, "B", "down")).toBeNull();
    });

    it("does not navigate across wrong axis", () => {
      const root: SplitNode = {
        type: "split",
        orientation: "horizontal",
        children: [leaf("A"), leaf("B")],
      };
      expect(findAdjacentLeaf(root, "A", "up")).toBeNull();
      expect(findAdjacentLeaf(root, "A", "down")).toBeNull();
    });

    it("navigates in mixed layout (horizontal root, vertical right child)", () => {
      // [A | [B / C]]
      const root: SplitNode = {
        type: "split",
        orientation: "horizontal",
        children: [
          leaf("A"),
          { type: "split", orientation: "vertical", children: [leaf("B"), leaf("C")] },
        ],
      };
      // Left/right across the horizontal split
      expect(findAdjacentLeaf(root, "A", "right")).toBe("B"); // nearest edge leaf
      expect(findAdjacentLeaf(root, "B", "left")).toBe("A");
      expect(findAdjacentLeaf(root, "C", "left")).toBe("A");
      // Up/down within the vertical split
      expect(findAdjacentLeaf(root, "B", "down")).toBe("C");
      expect(findAdjacentLeaf(root, "C", "up")).toBe("B");
      // No vertical neighbor for A
      expect(findAdjacentLeaf(root, "A", "up")).toBeNull();
      expect(findAdjacentLeaf(root, "A", "down")).toBeNull();
    });

    it("navigates in deeply nested layout", () => {
      // [[A / B] | [C / D]]
      const root: SplitNode = {
        type: "split",
        orientation: "horizontal",
        children: [
          { type: "split", orientation: "vertical", children: [leaf("A"), leaf("B")] },
          { type: "split", orientation: "vertical", children: [leaf("C"), leaf("D")] },
        ],
      };
      // Horizontal navigation picks nearest edge leaf
      expect(findAdjacentLeaf(root, "A", "right")).toBe("C");
      expect(findAdjacentLeaf(root, "B", "right")).toBe("C");
      expect(findAdjacentLeaf(root, "C", "left")).toBe("A");
      expect(findAdjacentLeaf(root, "D", "left")).toBe("A");
      // Vertical within each column
      expect(findAdjacentLeaf(root, "A", "down")).toBe("B");
      expect(findAdjacentLeaf(root, "C", "down")).toBe("D");
    });

    it("returns null for unknown leaf id", () => {
      const root: SplitNode = {
        type: "split",
        orientation: "horizontal",
        children: [leaf("A"), leaf("B")],
      };
      expect(findAdjacentLeaf(root, "Z", "left")).toBeNull();
    });
  });
});
