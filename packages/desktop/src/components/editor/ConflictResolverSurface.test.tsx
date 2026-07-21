import { describe, expect, it } from "vitest";
import type { ConflictContentSnapshot } from "@/api/generated";
import { conflictSourceLabels, textFromConflictContent } from "./ConflictResolverSurface";

describe("conflictSourceLabels", () => {
  it("uses operation-aware side labels and never shows generic sides during rebase", () => {
    expect(conflictSourceLabels("merge")).toMatchObject({
      stage2: "Current branch",
      stage3: "Incoming branch",
    });
    expect(conflictSourceLabels("rebase")).toMatchObject({
      stage2: "Rebased result",
      stage3: "Replayed commit",
    });
    expect(conflictSourceLabels(null)).toMatchObject({
      stage2: "Index stage 2",
      stage3: "Index stage 3",
    });
  });
});

describe("textFromConflictContent", () => {
  it("returns text bytes and treats absent or non-text sources as null", () => {
    const snapshot = {
      stage_2: { content: { state: "text", content: "ours\n" } },
      stage_3: { content: { state: "binary" } },
      base: null,
    } as unknown as ConflictContentSnapshot;
    expect(textFromConflictContent(snapshot.stage_2)).toBe("ours\n");
    expect(textFromConflictContent(snapshot.stage_3)).toBeNull();
    expect(textFromConflictContent(snapshot.base)).toBeNull();
  });
});
