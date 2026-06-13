/**
 * Pure lane-assignment for a commit graph — the layout that lets us draw the
 * "where did this come from" lines next to each commit, like `git log --graph`.
 *
 * Input is a topo-ordered commit list (children before parents) with each
 * commit's parent SHAs. Output is, per row, the column the commit node sits in
 * plus the lane occupancy entering (`lanesBefore`) and leaving (`lanesAfter`)
 * the row, so a renderer can stroke straight pass-through lanes and curve the
 * merge-in / branch-out edges into the node.
 *
 * Lanes keep their column for their whole life (no left-shifting) — this keeps
 * the routing trivial: the only diagonals are a child lane bending into its
 * commit (merge-in) and a new parent lane leaving the node (branch-out).
 */

export interface GraphCommitInput {
  sha: string;
  parents: string[];
}

export interface GraphRow {
  /** Column index of the commit node. */
  commitCol: number;
  /** Lane SHAs entering this row from above, indexed by column (`null` = empty). */
  lanesBefore: (string | null)[];
  /** Lane SHAs leaving toward the next row, indexed by column. */
  lanesAfter: (string | null)[];
  /** Columns whose incoming lane bends into the node (this commit's child edges). */
  mergeInCols: number[];
  /** Columns the node's parent lanes occupy below (branch-out edges). */
  parentCols: number[];
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Total lane columns across the whole graph (rows are padded to this width). */
  columns: number;
}

function firstFree(active: (string | null)[]): number {
  const i = active.indexOf(null);
  return i === -1 ? active.length : i;
}

function padTo(lanes: (string | null)[], width: number): void {
  while (lanes.length < width) lanes.push(null);
}

export function computeGraphLayout(commits: GraphCommitInput[]): GraphLayout {
  const active: (string | null)[] = []; // lane SHA, by column
  const rows: GraphRow[] = [];
  let maxCols = 0;

  for (const commit of commits) {
    const lanesBefore = active.slice();

    // Columns already waiting for this commit (edges from its children).
    const mergeInCols: number[] = [];
    for (let c = 0; c < active.length; c++) {
      if (active[c] === commit.sha) mergeInCols.push(c);
    }

    let commitCol: number;
    if (mergeInCols.length === 0) {
      // A tip with no visible children — open a fresh lane.
      commitCol = firstFree(active);
      if (commitCol === active.length) active.push(null);
    } else {
      commitCol = mergeInCols[0];
      // Extra child lanes merge into the commit column and close.
      for (let k = 1; k < mergeInCols.length; k++) active[mergeInCols[k]] = null;
    }

    // The first parent continues the commit's lane; extra parents (merges)
    // each open a lane, reusing freed columns where possible.
    const parentCols: number[] = [];
    if (commit.parents.length === 0) {
      active[commitCol] = null;
    } else {
      active[commitCol] = commit.parents[0];
      parentCols.push(commitCol);
      for (let k = 1; k < commit.parents.length; k++) {
        const slot = firstFree(active);
        if (slot === active.length) active.push(null);
        active[slot] = commit.parents[k];
        parentCols.push(slot);
      }
    }

    const lanesAfter = active.slice();
    maxCols = Math.max(maxCols, lanesBefore.length, lanesAfter.length);
    rows.push({ commitCol, lanesBefore, lanesAfter, mergeInCols, parentCols });
  }

  for (const row of rows) {
    padTo(row.lanesBefore, maxCols);
    padTo(row.lanesAfter, maxCols);
  }
  return { rows, columns: maxCols };
}
