/**
 * Parse a unified diff string into per-file sections.
 * Each section contains the file names and the hunk lines (starting from @@).
 *
 * Shared between DiffViewer (multi-file git diffs) and InlineDiffBlock (single-file inline diffs).
 */
export interface FileDiffSection {
  oldFileName: string;
  newFileName: string;
  hunks: string[];
}

export function parseUnifiedDiff(rawDiff: string): FileDiffSection[] {
  if (!rawDiff.trim()) return [];

  const sections: FileDiffSection[] = [];
  const lines = rawDiff.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Find next "diff --git" header
    if (!lines[i].startsWith("diff --git ")) {
      i++;
      continue;
    }

    let oldFileName = "";
    let newFileName = "";
    i++;

    // Parse header lines until we hit a hunk or next diff
    while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("diff --git ")) {
      if (lines[i].startsWith("--- ")) {
        oldFileName = lines[i].slice(4).replace(/^a\//, "");
      } else if (lines[i].startsWith("+++ ")) {
        newFileName = lines[i].slice(4).replace(/^b\//, "");
      }
      i++;
    }

    // Collect all hunk lines for this file
    const hunkLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      hunkLines.push(lines[i]);
      i++;
    }

    if (oldFileName || newFileName) {
      sections.push({
        oldFileName: oldFileName || "/dev/null",
        newFileName: newFileName || "/dev/null",
        hunks: hunkLines,
      });
    }
  }

  return sections;
}

/**
 * Infer a language identifier from a file path extension.
 * Used for syntax highlighting in diff views.
 */
export function langFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    scss: "scss",
    html: "xml",
    xml: "xml",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    swift: "swift",
    sql: "sql",
    sh: "shell",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    dockerfile: "dockerfile",
    makefile: "makefile",
  };
  return map[ext] ?? "plaintext";
}
