import { describe, expect, it } from "vitest";
import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { getCadenceDiffConfig } from "./diff-config";

function toText(content: string): Text {
  return Text.of(content.split(/\r?\n/));
}

function buildLargeSparseDiffFixture(): { oldContent: string; newContent: string } {
  const oldLines: string[] = [];

  for (let group = 0; group < 240; group++) {
    oldLines.push(`export function fn${group}() {`);
    for (let line = 0; line < 8; line++) {
      oldLines.push(`  const v${line} = ${(group + line) % 7};`);
    }
    oldLines.push("  return total;");
    oldLines.push("}");
    oldLines.push("");
  }

  const newLines = [...oldLines];
  newLines.splice(30, 0, "export interface Added {", "  value: string;", "}", "");
  newLines[700] = "  const v3 = 99;";
  newLines[1400] = "  const v4 = 88;";
  newLines.splice(2100, 0, "  const extra = true;");
  newLines[2800] = "  return changed;";

  return {
    oldContent: oldLines.join("\n"),
    newContent: newLines.join("\n"),
  };
}

describe("getCadenceDiffConfig", () => {
  it("keeps the default diff config for small files", () => {
    expect(getCadenceDiffConfig("small", "small diff")).toBeUndefined();
  });

  it("avoids collapsing large sparse diffs into one giant chunk", () => {
    const { oldContent, newContent } = buildLargeSparseDiffFixture();
    const oldText = toText(oldContent);
    const newText = toText(newContent);
    const cadenceDiffConfig = getCadenceDiffConfig(oldContent, newContent);

    const defaultChunks = Chunk.build(oldText, newText, { scanLimit: 500 });
    const cadenceChunks = Chunk.build(oldText, newText, cadenceDiffConfig);

    expect(cadenceDiffConfig).toEqual({ scanLimit: 20_000 });
    expect(defaultChunks).toHaveLength(1);
    expect(cadenceChunks).toHaveLength(5);
  });
});
