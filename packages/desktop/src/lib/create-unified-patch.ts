export interface UnifiedPatchInput {
  filePath: string;
  oldContent: string;
  newContent: string;
}

function splitContentLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function findCommonPrefix(oldLines: string[], newLines: string[]): number {
  const limit = Math.min(oldLines.length, newLines.length);
  let index = 0;
  while (index < limit && oldLines[index] === newLines[index]) index++;
  return index;
}

function findCommonSuffix(oldLines: string[], newLines: string[], prefix: number): number {
  const maxSuffix = Math.min(oldLines.length, newLines.length) - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }
  return suffix;
}

function formatRange(start: number, count: number): string {
  if (count === 1) return String(start);
  return `${start},${count}`;
}

export function createUnifiedPatch({
  filePath,
  oldContent,
  newContent,
}: UnifiedPatchInput): string {
  const oldLines = splitContentLines(oldContent);
  const newLines = splitContentLines(newContent);
  const prefix = findCommonPrefix(oldLines, newLines);
  const suffix = findCommonSuffix(oldLines, newLines, prefix);
  const oldChangedEnd = oldLines.length - suffix;
  const newChangedEnd = newLines.length - suffix;
  const contextStart = Math.max(0, prefix - 3);
  const oldContextEnd = Math.min(oldLines.length, oldChangedEnd + 3);
  const newContextEnd = Math.min(newLines.length, newChangedEnd + 3);
  const oldCount = oldContextEnd - contextStart;
  const newCount = newContextEnd - contextStart;
  const oldStart = oldCount === 0 ? 0 : contextStart + 1;
  const newStart = newCount === 0 ? 0 : contextStart + 1;
  const body: string[] = [];

  for (let index = contextStart; index < prefix; index++) body.push(` ${oldLines[index]}`);
  for (let index = prefix; index < oldChangedEnd; index++) body.push(`-${oldLines[index]}`);
  for (let index = prefix; index < newChangedEnd; index++) body.push(`+${newLines[index]}`);
  for (let index = oldChangedEnd; index < oldContextEnd; index++) body.push(` ${oldLines[index]}`);

  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- ${oldContent.length === 0 ? "/dev/null" : `a/${filePath}`}`,
    `+++ ${newContent.length === 0 ? "/dev/null" : `b/${filePath}`}`,
    `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`,
    ...body,
    "",
  ].join("\n");
}
