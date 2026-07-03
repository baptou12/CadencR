import { describe, expect, it } from "vitest";
import { parseScene } from "./excalidraw-scene";

describe("parseScene", () => {
  it("returns a neutral result while content is still loading", () => {
    expect(parseScene(undefined)).toEqual({ initialData: null, error: null });
  });

  it("treats an empty (or whitespace-only) file as a blank scene", () => {
    for (const content of ["", "   \n"]) {
      const { initialData, error } = parseScene(content);
      expect(error).toBeNull();
      expect(initialData).toEqual({ scrollToContent: true });
    }
  });

  it("loads a valid scene and enables scroll-to-content on open", () => {
    const elements = [{ id: "a", type: "rectangle" }];
    const { initialData, error } = parseScene(
      JSON.stringify({ type: "excalidraw", version: 2, elements, appState: { foo: 1 } }),
    );
    expect(error).toBeNull();
    expect(initialData).toMatchObject({
      elements,
      appState: { foo: 1 },
      scrollToContent: true,
    });
  });

  it("reports invalid JSON instead of throwing", () => {
    const { initialData, error } = parseScene("{ not json");
    expect(initialData).toBeNull();
    expect(error).toMatch(/isn't valid JSON/);
  });

  it.each([['"just a string"'], ["42"], ["null"], ["[1,2,3]"]])(
    "rejects non-object JSON %s as an invalid scene",
    (content) => {
      const { initialData, error } = parseScene(content);
      expect(initialData).toBeNull();
      expect(error).toMatch(/isn't a valid scene/);
    },
  );
});
