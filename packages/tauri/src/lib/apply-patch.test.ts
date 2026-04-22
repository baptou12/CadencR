import { describe, expect, it } from "vitest";
import {
  extractApplyPatchPreview,
  extractApplyPatchPrimaryPath,
  parseApplyPatchChanges,
} from "./apply-patch";

describe("parseApplyPatchChanges", () => {
  it("parses add and update file markers", () => {
    const changes = parseApplyPatchChanges(
      "*** Begin Patch\n*** Add File: src/new.ts\n+hello\n*** Update File: src/existing.ts\n@@\n-old\n+new\n*** End Patch\n",
    );

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      kind: "add",
      filePath: "src/new.ts",
      addedLines: ["hello"],
    });
    expect(changes[1]).toMatchObject({ kind: "update", filePath: "src/existing.ts" });
  });
});

describe("extractApplyPatchPrimaryPath", () => {
  it("extracts the first patched path from patchText", () => {
    expect(
      extractApplyPatchPrimaryPath({
        patchText: "*** Begin Patch\n*** Add File: toto.txt\n+hello\n*** End Patch\n",
      }),
    ).toBe("toto.txt");
  });
});

describe("extractApplyPatchPreview", () => {
  it("builds a write-like preview for add file patches", () => {
    expect(
      extractApplyPatchPreview({
        patchText: "*** Begin Patch\n*** Add File: toto.txt\n+hello\n+world\n*** End Patch\n",
      }),
    ).toEqual({
      filePath: "toto.txt",
      oldContent: "",
      newContent: "hello\nworld",
    });
  });

  it("builds an edit-like preview for update patches", () => {
    expect(
      extractApplyPatchPreview({
        patchText: "*** Begin Patch\n*** Update File: src/foo.ts\n@@\n-old\n+new\n*** End Patch\n",
      }),
    ).toEqual({
      filePath: "src/foo.ts",
      oldContent: "old",
      newContent: "new",
    });
  });

  it("builds a visible create preview when add patch has no added hunk lines", () => {
    expect(
      extractApplyPatchPreview({
        patchText: "*** Begin Patch\n*** Add File: toto.txt\n*** End Patch\n",
      }),
    ).toEqual({
      filePath: "toto.txt",
      oldContent: "",
      newContent: "(file created)",
    });
  });

  it("builds a visible delete preview when delete patch has no removed hunk lines", () => {
    expect(
      extractApplyPatchPreview({
        patchText: "*** Begin Patch\n*** Delete File: toto.txt\n*** End Patch\n",
      }),
    ).toEqual({
      filePath: "toto.txt",
      oldContent: "(file deleted)",
      newContent: "",
    });
  });
});
