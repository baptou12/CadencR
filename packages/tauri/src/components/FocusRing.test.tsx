import { describe, it, expect } from "vitest";
import { render } from "@/test-utils";
import { FocusRing } from "./FocusRing";

describe("FocusRing", () => {
  it("renders a focus ring div", () => {
    const { container } = render(<FocusRing />);
    const ring = container.firstChild as HTMLElement;
    expect(ring).toBeInTheDocument();
  });

  it("is initially invisible (opacity 0)", () => {
    const { container } = render(<FocusRing />);
    const ring = container.firstChild as HTMLElement;
    expect(ring.style.opacity).toBe("0");
  });

  it("has pointer-events none", () => {
    const { container } = render(<FocusRing />);
    const ring = container.firstChild as HTMLElement;
    expect(ring.style.pointerEvents).toBe("none");
  });

  it("renders in document body", () => {
    const { container } = render(<FocusRing />);
    expect(container.childElementCount).toBeGreaterThan(0);
  });
});
