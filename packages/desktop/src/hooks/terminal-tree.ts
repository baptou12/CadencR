// Pure tree operations for the terminal split layout. Separated from
// useTerminalState.ts so that the store file stays well under the 400-line
// limit; this file holds no React or Zustand state, only data structures
// and pure functions.

export type SplitOrientation = "horizontal" | "vertical";

/** A leaf node represents a single terminal pane */
export interface TerminalLeaf {
  type: "leaf";
  id: string;
  ptyId?: string;
  initialCommand?: string;
  /** Working directory the PTY was spawned in (reported by the backend on Ready/Reconnected). */
  cwd?: string;
  /** True if the user dismissed the cwd-mismatch warning for this pane. */
  cwdWarningDismissed?: boolean;
  /**
   * Display-only line written to the terminal once the fresh PTY is ready
   * (e.g. "→ cd <worktree>"), so a pane restarted into a new working directory
   * tells the user where it landed. Never sent to the shell.
   */
  initialNotice?: string;
}

/** A split node contains two children arranged in a given orientation */
export interface TerminalSplit {
  type: "split";
  orientation: SplitOrientation;
  children: [SplitNode, SplitNode];
}

export type SplitNode = TerminalLeaf | TerminalSplit;

/**
 * A pane's live shell no longer matches the feature's expected working
 * directory (e.g. a worktree was just created) and the user hasn't dismissed
 * the mismatch. Shared by the auto-switch hook and the warning banner so the
 * "should this pane warn/switch?" rule lives in one place.
 */
export function isCwdStale(leaf: TerminalLeaf, expectedCwd: string | null): boolean {
  return Boolean(
    leaf.ptyId && leaf.cwd && expectedCwd && leaf.cwd !== expectedCwd && !leaf.cwdWarningDismissed,
  );
}

export type Direction = "left" | "right" | "up" | "down";

interface PathStep {
  node: TerminalSplit;
  childIndex: 0 | 1;
}

/** Collect all leaves in DFS order (left-to-right, top-to-bottom) */
export function getLeaves(node: SplitNode): TerminalLeaf[] {
  if (node.type === "leaf") return [node];
  return [...getLeaves(node.children[0]), ...getLeaves(node.children[1])];
}

/** Replace a leaf with a split containing the original + a new leaf */
export function splitLeaf(
  node: SplitNode,
  leafId: string,
  orientation: SplitOrientation,
  newLeaf: TerminalLeaf,
): SplitNode {
  if (node.type === "leaf") {
    if (node.id === leafId) {
      return { type: "split", orientation, children: [node, newLeaf] };
    }
    return node;
  }
  const [a, b] = node.children;
  const newA = splitLeaf(a, leafId, orientation, newLeaf);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = splitLeaf(b, leafId, orientation, newLeaf);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

/** Remove a leaf and collapse its parent split. Returns null if the tree is now empty. */
export function removeLeaf(node: SplitNode, leafId: string): SplitNode | null {
  if (node.type === "leaf") {
    return node.id === leafId ? null : node;
  }
  const [a, b] = node.children;
  const newA = removeLeaf(a, leafId);
  if (newA === null) return b;
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = removeLeaf(b, leafId);
  if (newB === null) return a;
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

/** Replace a leaf with another leaf, preserving the surrounding split tree */
export function replaceLeaf(node: SplitNode, leafId: string, replacement: TerminalLeaf): SplitNode {
  if (node.type === "leaf") {
    return node.id === leafId ? replacement : node;
  }
  const [a, b] = node.children;
  const newA = replaceLeaf(a, leafId, replacement);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = replaceLeaf(b, leafId, replacement);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

/** Update a leaf's fields by id */
export function updateLeaf(
  node: SplitNode,
  leafId: string,
  updater: (leaf: TerminalLeaf) => TerminalLeaf,
): SplitNode {
  if (node.type === "leaf") {
    return node.id === leafId ? updater(node) : node;
  }
  const [a, b] = node.children;
  const newA = updateLeaf(a, leafId, updater);
  if (newA !== a) return { ...node, children: [newA, b] };
  const newB = updateLeaf(b, leafId, updater);
  if (newB !== b) return { ...node, children: [a, newB] };
  return node;
}

// ---------------------------------------------------------------------------
// Spatial navigation
// ---------------------------------------------------------------------------

function directionAxis(dir: Direction): SplitOrientation {
  return dir === "left" || dir === "right" ? "horizontal" : "vertical";
}

function findPathToLeaf(node: SplitNode, leafId: string): PathStep[] | null {
  if (node.type === "leaf") return node.id === leafId ? [] : null;
  for (const idx of [0, 1] as const) {
    const result = findPathToLeaf(node.children[idx], leafId);
    if (result !== null) return [{ node, childIndex: idx }, ...result];
  }
  return null;
}

function nearestLeafOnEdge(node: SplitNode, dir: Direction): string {
  if (node.type === "leaf") return node.id;
  const axis = directionAxis(dir);
  if (node.orientation === axis) {
    const pick = dir === "left" || dir === "up" ? 1 : 0;
    return nearestLeafOnEdge(node.children[pick], dir);
  }
  return nearestLeafOnEdge(node.children[0], dir);
}

/** Find the spatially adjacent leaf in the given direction */
export function findAdjacentLeaf(
  root: SplitNode,
  leafId: string,
  direction: Direction,
): string | null {
  const path = findPathToLeaf(root, leafId);
  if (!path) return null;
  const axis = directionAxis(direction);
  const departingIndex: 0 | 1 = direction === "left" || direction === "up" ? 1 : 0;
  for (let i = path.length - 1; i >= 0; i--) {
    const step = path[i];
    if (step.node.orientation === axis && step.childIndex === departingIndex) {
      const otherChild = step.node.children[departingIndex === 1 ? 0 : 1];
      return nearestLeafOnEdge(otherChild, direction);
    }
  }
  return null;
}
