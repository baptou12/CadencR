import { tags as t } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { editorHighlightStyles } from "../editor-theme";

describe("editorHighlightStyles", () => {
  it("colors property names so YAML and config keys do not look like plain text", () => {
    const propertyStyle = editorHighlightStyles.find((style) => {
      const tags = Array.isArray(style.tag) ? style.tag : [style.tag];
      return tags.includes(t.propertyName);
    });

    expect(propertyStyle?.color).toBe("var(--editor-cyan)");
  });
});
