import { describe, expect, it } from "vitest";
import type { FileTreeEntry } from "@/api/generated";
import {
  collectLazyIgnoredEntries,
  knownIgnoredDirectoryPaths,
  mergeFileTreeEntries,
} from "./lazyIgnoredFileTreeEntries";

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

  it("treats tracked-but-ignored directories as lazily expandable (issue #41)", () => {
    // A directory added to `.gitignore` after being committed is surfaced by
    // the backend in the tracked query (dimmed), not in lazyEntries — but
    // expanding it must still reveal its untracked ignored children.
    const tracked = [
      entry("src", true),
      entry("dist", true, true),
      entry("dist/bundle.js", false, true),
    ];
    const lazy = [entry("node_modules", true, true)];

    expect([...knownIgnoredDirectoryPaths(tracked, lazy)].sort()).toEqual(["dist", "node_modules"]);
  });

  it("dedupes a directory present in both tracked and lazy entries", () => {
    const tracked = [entry("dist", true, true)];
    const lazy = [entry("dist", true, true)];

    expect(knownIgnoredDirectoryPaths(tracked, lazy)).toEqual(["dist"]);
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
