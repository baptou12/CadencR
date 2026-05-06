import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppEnvironmentBadge } from "./AppEnvironmentBadge";

describe("AppEnvironmentBadge", () => {
  it("renders the beta badge with theme-aware contrast classes", () => {
    render(<AppEnvironmentBadge kind="beta" />);

    expect(screen.getByText("beta")).toHaveClass("bg-primary/15", "text-primary");
  });

  it("renders the dev badge with the existing orange tone", () => {
    render(<AppEnvironmentBadge kind="dev" />);

    expect(screen.getByText("dev")).toHaveClass("bg-orange-500/20", "text-orange-400");
  });
});
