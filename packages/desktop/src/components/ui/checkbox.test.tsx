import { describe, expect, it } from "vitest";
import { render, screen } from "@/test-utils";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("uses the high-contrast control border while unchecked", () => {
    render(<Checkbox aria-label="Include files" />);

    expect(screen.getByRole("checkbox", { name: "Include files" })).toHaveClass(
      "border-control-border",
      "focus-visible:ring-control-focus-ring",
    );
  });

  it("keeps the accessible checked state", async () => {
    const { user } = render(<Checkbox aria-label="Include files" />);
    const checkbox = screen.getByRole("checkbox", { name: "Include files" });

    await user.click(checkbox);

    expect(checkbox).toBeChecked();
  });
});
