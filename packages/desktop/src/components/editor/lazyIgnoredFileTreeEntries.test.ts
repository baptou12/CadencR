import { describe, expect, it } from "vitest";
import type { FileTreeEntry } from "@/api/generated";
import { collectLazyIgnoredEntries, mergeFileTreeEntries } from "./lazyIgnoredFileTreeEntries";

function entry(path: string, isDir = false, isGitignored = false): FileTreeEntry {
  return { name: path, path, is_dir: isDir, is_gitignored: isGitignored };
}

describe("lazy ignored file-tree entries", () => {
  it("keeps only top-level ignored entries from the root directory query", () => {
    const rootEntries = [entry("packages", true), entry("node_modules", true, true)];

    expect(collectLazyIgnoredEntries([{ dirPath: ".", entries: rootEntries }], [])).toEqual([
      entry("node_modules", true, true),
    ]);
  });

  it("includes direct children for expanded ignored directories", () => {
    const entries = collectLazyIgnoredEntries(
      [
        { dirPath: ".", entries: [entry("node_modules", true, true)] },
        { dirPath: "node_modules", entries: [entry("node_modules/pkg", true, true)] },
      ],
      [],
    );

    expect(entries.map((item) => item.path)).toEqual(["node_modules", "node_modules/pkg"]);
  });

  it("marks children of ignored directories as ignored even when the endpoint does not", () => {
    const entries = collectLazyIgnoredEntries(
      [
        { dirPath: ".", entries: [entry("node_modules", true, true)] },
        { dirPath: "node_modules", entries: [entry("node_modules/pkg", true, false)] },
      ],
      [],
    );

    expect(entries.find((item) => item.path === "node_modules/pkg")?.is_gitignored).toBe(true);
  });

  it("merges lazy ignored entries without duplicating tracked entries", () => {
    const tracked = [entry("src/main.ts")];
    const lazy = [entry("src/main.ts"), entry("node_modules", true, true)];

    expect(mergeFileTreeEntries(tracked, lazy)?.map((item) => item.path)).toEqual([
      "src/main.ts",
      "node_modules",
    ]);
  });
});
