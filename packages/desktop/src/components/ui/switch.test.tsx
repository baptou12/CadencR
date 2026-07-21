import { describe, expect, it } from "vitest";
import { render, screen } from "@/test-utils";
import { Switch } from "./switch";

describe("Switch", () => {
  it("uses the high-contrast control fill while unchecked", () => {
    render(<Switch aria-label="Fluid animations" />);

    const toggle = screen.getByRole("switch", { name: "Fluid animations" });
    expect(toggle).toHaveClass(
      "data-[state=unchecked]:bg-control-border",
      "focus-visible:ring-control-focus-ring",
    );
    expect(toggle).not.toHaveClass("dark:data-[state=unchecked]:bg-input/80");
  });

  it("keeps the accessible checked state", async () => {
    const { user } = render(<Switch aria-label="Fluid animations" />);
    const toggle = screen.getByRole("switch", { name: "Fluid animations" });

    await user.click(toggle);

    expect(toggle).toBeChecked();
  });
});
