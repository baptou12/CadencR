import type {
  Direction,
  EditorLeaf,
  EditorSplit,
  EditorSplitNode,
  SplitOrientation,
} from "./editor-store-types";

// ---------------------------------------------------------------------------
// Split tree helpers
// ---------------------------------------------------------------------------

export function getEditorLeaves(node: EditorSplitNode): EditorLeaf[] {
  if (node.type === "leaf") return [node];
  return [...getEditorLeaves(node.children[0]), ...getEditorLeaves(node.children[1])];
}

export function splitLeaf(
  node: EditorSplitNode,
  leafId: string,
  orientation: SplitOrientation,
  newLeaf: EditorLeaf,
): EditorSplitNode {
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

export function removeLeaf(node: EditorSplitNode, leafId: string): EditorSplitNode | null {
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

// ---------------------------------------------------------------------------
// Spatial navigation helpers
// ---------------------------------------------------------------------------

interface PathStep {
  node: EditorSplit;
  childIndex: 0 | 1;
}

function directionAxis(dir: Direction): SplitOrientation {
  return dir === "left" || dir === "right" ? "horizontal" : "vertical";
}

function findPathToLeaf(node: EditorSplitNode, leafId: string): PathStep[] | null {
  if (node.type === "leaf") return node.id === leafId ? [] : null;
  for (const idx of [0, 1] as const) {
    const result = findPathToLeaf(node.children[idx], leafId);
    if (result !== null) return [{ node, childIndex: idx }, ...result];
  }
  return null;
}

function nearestLeafOnEdge(node: EditorSplitNode, dir: Direction): string {
  if (node.type === "leaf") return node.id;
  const axis = directionAxis(dir);
  if (node.orientation === axis) {
    const pick = dir === "left" || dir === "up" ? 1 : 0;
    return nearestLeafOnEdge(node.children[pick], dir);
  }
  return nearestLeafOnEdge(node.children[0], dir);
}

export function findAdjacentEditorLeaf(
  root: EditorSplitNode,
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
