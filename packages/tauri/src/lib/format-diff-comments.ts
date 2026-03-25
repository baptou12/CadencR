/**
 * Formats diff comments into a markdown string grouped by file path,
 * suitable for sending to an agent.
 */
export function formatCommentsForAgent(
  comments: { file_path: string; line_number: number; content: string }[],
): string {
  const grouped = new Map<string, { line_number: number; content: string }[]>();
  for (const c of comments) {
    const list = grouped.get(c.file_path) ?? [];
    list.push({ line_number: c.line_number, content: c.content });
    grouped.set(c.file_path, list);
  }
  const parts: string[] = [];
  for (const [filePath, items] of grouped) {
    parts.push(`## ${filePath}`);
    for (const item of items) {
      parts.push(`- Line ${item.line_number}: ${item.content}`);
    }
  }
  return parts.join("\n");
}
