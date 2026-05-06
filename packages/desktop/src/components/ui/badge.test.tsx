import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders with default variant", () => {
    render(<Badge>Status</Badge>);
    const badge = screen.getByText("Status");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("data-variant", "default");
  });

  it("renders with destructive variant", () => {
    render(<Badge variant="destructive">Error</Badge>);
    const badge = screen.getByText("Error");
    expect(badge).toHaveAttribute("data-variant", "destructive");
  });
});
