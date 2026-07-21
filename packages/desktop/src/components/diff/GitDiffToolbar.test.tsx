import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GitDiffToolbar } from "./GitDiffToolbar";

describe("GitDiffToolbar", () => {
  it("switches display modes and exposes viewed progress", () => {
    const onChange = vi.fn();
    render(
      <GitDiffToolbar
        diffMode="unified"
        onDiffModeChange={onChange}
        isPreferenceLoading={false}
        viewedCount={2}
        fileCount={5}
        isViewedPending
      />,
    );
    expect(screen.getByRole("toolbar", { name: "Diff display" })).toHaveTextContent(
      "2/5 viewed · Updating…",
    );
    expect(screen.getByRole("button", { name: "Unified" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(onChange).toHaveBeenCalledWith("split");
  });

  it("omits unsupported viewed progress and exposes preference loading", () => {
    render(<GitDiffToolbar diffMode="split" onDiffModeChange={vi.fn()} isPreferenceLoading />);
    expect(screen.queryByText(/viewed/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading display…");
    expect(screen.getByRole("button", { name: "Split" })).toBeDisabled();
  });
});
