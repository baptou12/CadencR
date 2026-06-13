import { describe, it, expect } from "vitest";
import { computeGraphLayout } from "./git-graph-layout";

describe("computeGraphLayout", () => {
  it("places a linear history in a single column", () => {
    const { rows, columns } = computeGraphLayout([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(columns).toBe(1);
    expect(rows.map((r) => r.commitCol)).toEqual([0, 0, 0]);
    // The root closes its lane.
    expect(rows[2].lanesAfter).toEqual([null]);
  });

  it("opens a second lane for a divergent branch and reunites at the merge base", () => {
    // feature (f) and main (m) both descend from base (a); listed in topo order.
    const { rows, columns } = computeGraphLayout([
      { sha: "f", parents: ["a"] },
      { sha: "m", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(columns).toBe(2);
    expect(rows[0].commitCol).toBe(0); // f in lane 0
    expect(rows[1].commitCol).toBe(1); // m opens lane 1
    // Both lanes are waiting for `a` entering its row...
    expect(rows[2].lanesBefore).toEqual(["a", "a"]);
    // ...and `a` sits in lane 0, merging lane 1 into it.
    expect(rows[2].commitCol).toBe(0);
    expect(rows[2].mergeInCols).toEqual([0, 1]);
    expect(rows[2].lanesAfter).toEqual([null, null]);
  });

  it("records branch-out columns for a merge commit's parents", () => {
    const { rows } = computeGraphLayout([
      { sha: "merge", parents: ["p1", "p2"] },
      { sha: "p1", parents: ["base"] },
      { sha: "p2", parents: ["base"] },
      { sha: "base", parents: [] },
    ]);
    // The merge keeps lane 0 for p1 and opens lane 1 for p2.
    expect(rows[0].parentCols).toEqual([0, 1]);
    expect(rows[0].lanesAfter).toEqual(["p1", "p2"]);
    // base reunites both lanes.
    expect(rows[3].mergeInCols).toEqual([0, 1]);
  });

  it("treats a commit whose child is off-page as a fresh tip", () => {
    const { rows, columns } = computeGraphLayout([{ sha: "x", parents: ["y"] }]);
    expect(columns).toBe(1);
    expect(rows[0].commitCol).toBe(0);
    expect(rows[0].mergeInCols).toEqual([]);
    expect(rows[0].lanesAfter).toEqual(["y"]);
  });

  it("handles an empty input", () => {
    expect(computeGraphLayout([])).toEqual({ rows: [], columns: 0 });
  });
});
