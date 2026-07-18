import type { FileTreeOptions } from "@pierre/trees";
import type { ChangedFile } from "@/api/generated";
import { getFileName } from "@/lib/file-language";

type PierreGitStatus = NonNullable<FileTreeOptions["gitStatus"]>[number]["status"];

export type GitDiffTreeDisplayMode = "tree" | "filenames";

export interface GitDiffTreePresentation {
  paths: readonly string[];
  gitStatus: NonNullable<FileTreeOptions["gitStatus"]>;
  treePathByFilePath: ReadonlyMap<string, string>;
  filePathByTreePath: ReadonlyMap<string, string>;
  labels: readonly { treePath: string; label: string }[];
}

interface BuildGitDiffTreePresentationOptions {
  files: readonly ChangedFile[];
  displayMode: GitDiffTreeDisplayMode;
  statusFromFile: (file: ChangedFile) => PierreGitStatus;
  hierarchicalPaths: readonly string[];
}

function stablePathHash(filePath: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < filePath.length; index += 1) {
    hash ^= filePath.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function withStableSuffix(name: string, suffix: string): string {
  const extensionIndex = name.lastIndexOf(".");
  if (extensionIndex <= 0) return `${name}--${suffix}`;
  return `${name.slice(0, extensionIndex)}--${suffix}${name.slice(extensionIndex)}`;
}

function buildFlatTreePaths(files: readonly ChangedFile[]): Map<string, string> {
  const usedPaths = new Set<string>();
  const treePathByFilePath = new Map<string, string>();
  const sortedFilePaths = [...new Set(files.map((file) => file.file))].sort();
  const fileNameCounts = new Map<string, number>();
  for (const filePath of sortedFilePaths) {
    const name = getFileName(filePath);
    fileNameCounts.set(name, (fileNameCounts.get(name) ?? 0) + 1);
  }
  for (const filePath of sortedFilePaths) {
    const name = getFileName(filePath);
    if (fileNameCounts.get(name) !== 1) continue;
    usedPaths.add(name);
    treePathByFilePath.set(filePath, name);
  }
  for (const filePath of sortedFilePaths) {
    const name = getFileName(filePath);
    if (fileNameCounts.get(name) === 1) continue;
    const basePath = withStableSuffix(name, stablePathHash(filePath));
    let treePath = basePath;
    let collision = 2;
    while (usedPaths.has(treePath)) {
      treePath = withStableSuffix(name, `${stablePathHash(filePath)}-${collision}`);
      collision += 1;
    }
    usedPaths.add(treePath);
    treePathByFilePath.set(filePath, treePath);
  }
  return treePathByFilePath;
}

export function buildGitDiffTreePresentation({
  files,
  displayMode,
  statusFromFile,
  hierarchicalPaths,
}: BuildGitDiffTreePresentationOptions): GitDiffTreePresentation {
  const treePathByFilePath =
    displayMode === "tree"
      ? new Map(files.map((file) => [file.file, file.file]))
      : buildFlatTreePaths(files);
  const filePathByTreePath = new Map(
    [...treePathByFilePath].map(([filePath, treePath]) => [treePath, filePath]),
  );
  const paths =
    displayMode === "tree"
      ? hierarchicalPaths
      : files.flatMap((file) => treePathByFilePath.get(file.file) ?? []);
  const gitStatus = files.flatMap((file) => {
    const path = treePathByFilePath.get(file.file);
    return path ? [{ path, status: statusFromFile(file) }] : [];
  });
  const labels =
    displayMode === "filenames"
      ? files.flatMap((file) => {
          const treePath = treePathByFilePath.get(file.file);
          const label = getFileName(file.file);
          return treePath && treePath !== label ? [{ treePath, label }] : [];
        })
      : [];
  return { paths, gitStatus, treePathByFilePath, filePathByTreePath, labels };
}

function quoteCssString(value: string): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === "\\") escaped += "\\\\";
    else if (character === '"') escaped += '\\"';
    else if (codePoint < 32 || codePoint === 127) escaped += `\\${codePoint.toString(16)} `;
    else escaped += character;
  }
  return `"${escaped}"`;
}

export function buildGitDiffTreeShadowCss(labels: GitDiffTreePresentation["labels"]): string {
  const rules = [
    ":host {",
    "  --trees-padding-inline-override: 4px;",
    "  --trees-item-padding-x-override: 4px;",
    "  --trees-item-margin-x-override: 0px;",
    "  --trees-level-gap-override: 4px;",
    "  --trees-item-row-gap-override: 4px;",
    "  --trees-icon-width-override: 14px;",
    "}",
    "[data-file-tree-search-container] {",
    "  padding-top: 4px;",
    "}",
  ];
  for (const { treePath, label } of labels) {
    const selector = `[data-item-path=${quoteCssString(treePath)}] > [data-item-section="content"]`;
    rules.push(`${selector} > * { display: none; }`);
    rules.push(`${selector}::after { content: ${quoteCssString(label)}; white-space: nowrap; }`);
  }
  return rules.join("\n");
}
