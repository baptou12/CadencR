import { describe, expect, it } from "vitest";
import { splitFilePatch } from "./split-file-patch";
import { countHunkStats, parseUnifiedDiff } from "./parse-unified-diff";

const HEADER = `diff --git a/big.ts b/big.ts
index 1111111..2222222 100644
--- a/big.ts
+++ b/big.ts`;

function makeSingleHunkPatch(changedLines: number): string {
  const body = Array.from({ length: changedLines }, (_, i) => `+added line ${i}`).join("\n");
  return `${HEADER}\n@@ -0,0 +1,${changedLines} @@\n${body}\n`;
}

/** Every content line (order preserved) across all chunk bodies. */
function contentLines(patch: string): string[] {
  const lines = patch.split("\n");
  const start = lines.findIndex((line) => line.startsWith("@@"));
  return lines.slice(start).filter((line) => !line.startsWith("@@") && line !== "");
}

describe("splitFilePatch", () => {
  it("returns a small patch verbatim", () => {
    const patch = makeSingleHunkPatch(50);
    expect(splitFilePatch(patch)).toEqual([patch]);
  });

  it("returns a patch with no hunks verbatim", () => {
    const patch = `${HEADER}\n`;
    expect(splitFilePatch(patch)).toEqual([patch]);
  });

  it("splits a giant single-hunk patch into bounded, self-contained chunks", () => {
    const patch = makeSingleHunkPatch(2000);
    const chunks = splitFilePatch(patch);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Each chunk repeats the file header and parses as a standalone diff.
      expect(chunk.startsWith("diff --git a/big.ts b/big.ts")).toBe(true);
      const sections = parseUnifiedDiff(chunk);
      expect(sections).toHaveLength(1);
      expect(sections[0].newFileName).toBe("big.ts");
      // No chunk exceeds the line budget (400 content lines).
      expect(contentLines(chunk).length).toBeLessThanOrEqual(400);
    }

    // Nothing lost, order preserved.
    expect(chunks.flatMap(contentLines)).toEqual(contentLines(patch));

    // Stats across chunks add up to the original.
    const totals = chunks
      .map((chunk) => countHunkStats([chunk]))
      .reduce((acc, s) => ({
        additions: acc.additions + s.additions,
        deletions: acc.deletions + s.deletions,
      }));
    expect(totals).toEqual(countHunkStats([patch]));
  });

  it("recomputes hunk headers so line numbers continue across chunks", () => {
    const patch = makeSingleHunkPatch(1000);
    const chunks = splitFilePatch(patch);

    let expectedNewStart = 1;
    for (const chunk of chunks) {
      const header = /@@ -\d+,\d+ \+(\d+),(\d+) @@/.exec(chunk);
      expect(header).not.toBeNull();
      expect(Number(header?.[1])).toBe(expectedNewStart);
      expectedNewStart += Number(header?.[2]);
    }
    expect(expectedNewStart).toBe(1001);
  });

  it("splits on the byte budget when lines are long", () => {
    const longLine = "x".repeat(2_000);
    const body = Array.from({ length: 100 }, () => `+${longLine}`).join("\n");
    const patch = `${HEADER}\n@@ -0,0 +1,100 @@\n${body}\n`;

    const chunks = splitFilePatch(patch);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // 100KB byte budget with headroom for the repeated header.
      expect(chunk.length).toBeLessThanOrEqual(110_000);
    }
  });

  it("keeps a no-newline marker attached to its line", () => {
    const added = Array.from({ length: 500 }, (_, i) => `+line ${i}`).join("\n");
    const patch = `${HEADER}\n@@ -1,1 +1,500 @@\n-old last line\n${added}\n\\ No newline at end of file\n`;

    const chunks = splitFilePatch(patch);
    const withMarker = chunks.filter((chunk) => chunk.includes("\\ No newline at end of file"));
    expect(withMarker).toHaveLength(1);
    const lines = withMarker[0].split("\n").filter((line) => line !== "");
    expect(lines[lines.length - 1]).toBe("\\ No newline at end of file");
    expect(lines[lines.length - 2]).toBe("+line 499");
  });

  it("preserves multi-hunk patches, packing whole hunks into chunks", () => {
    const hunk = (oldStart: number, newStart: number): string =>
      `@@ -${oldStart},3 +${newStart},3 @@\n context\n-removed ${oldStart}\n+added ${newStart}\n context`;
    const patch = `${HEADER}\n${hunk(10, 10)}\n${hunk(100, 100)}\n`;

    // Two tiny hunks fit one chunk → verbatim.
    expect(splitFilePatch(patch)).toEqual([patch]);
  });
});
