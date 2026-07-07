import { describe, it, expect } from "vitest";
import { render } from "@/test-utils";
import { DiffStatusIcon, deriveChangeTypeFromStatus } from "./DiffStatusIcon";

describe("deriveChangeTypeFromStatus", () => {
  it("maps an added file", () => {
    expect(deriveChangeTypeFromStatus("A")).toBe("new");
  });

  it("maps a deleted file", () => {
    expect(deriveChangeTypeFromStatus("D")).toBe("deleted");
  });

  it("maps rename and copy codes (with a similarity score)", () => {
    expect(deriveChangeTypeFromStatus("R100")).toBe("renamed");
    expect(deriveChangeTypeFromStatus("C075")).toBe("renamed");
  });

  it("defaults to a modification", () => {
    expect(deriveChangeTypeFromStatus("M")).toBe("change");
  });
});

describe("DiffStatusIcon", () => {
  it("renders Pierre's glyph for the change type", () => {
    const { container } = render(<DiffStatusIcon type="new" appearance="dark" />);
    expect(container.querySelector('use[href="#diffs-icon-symbol-added"]')).toBeInTheDocument();
  });
});
