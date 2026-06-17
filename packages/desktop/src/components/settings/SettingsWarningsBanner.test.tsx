import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsWarningsBanner } from "./SettingsWarningsBanner";

describe("SettingsWarningsBanner", () => {
  it("renders nothing when there are no warnings", () => {
    const { container } = render(<SettingsWarningsBanner warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each warning with a count header", () => {
    render(
      <SettingsWarningsBanner
        warnings={[
          { key: "made_up", message: '"made_up" is not a recognized setting' },
          { key: "editor_auto_save", message: "invalid value — using default" },
        ]}
      />,
    );
    expect(screen.getByText("2 settings warnings")).toBeInTheDocument();
    expect(screen.getByText('"made_up" is not a recognized setting')).toBeInTheDocument();
    expect(screen.getByText("invalid value — using default")).toBeInTheDocument();
  });

  it("uses the singular header for a single warning", () => {
    render(<SettingsWarningsBanner warnings={[{ key: "x", message: "bad" }]} />);
    expect(screen.getByText("1 settings warning")).toBeInTheDocument();
  });
});
