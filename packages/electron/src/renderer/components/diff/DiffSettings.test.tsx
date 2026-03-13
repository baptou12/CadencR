import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { DiffSettingsPopover, defaultDiffSettings, type DiffSettings } from "./DiffSettings";

describe("DiffSettingsPopover", () => {
  it("renders the settings button", () => {
    render(
      <DiffSettingsPopover
        settings={defaultDiffSettings}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTitle("Diff settings")).toBeInTheDocument();
  });

  it("shows popover when button is clicked", () => {
    render(
      <DiffSettingsPopover
        settings={defaultDiffSettings}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Diff settings"));
    expect(screen.getByText("Font Size")).toBeInTheDocument();
    expect(screen.getByText("Diff Mode")).toBeInTheDocument();
    expect(screen.getByText("Line Mode")).toBeInTheDocument();
  });

  it("closes popover when button is clicked again", () => {
    render(
      <DiffSettingsPopover
        settings={defaultDiffSettings}
        onChange={vi.fn()}
      />,
    );
    const btn = screen.getByTitle("Diff settings");
    fireEvent.click(btn);
    expect(screen.getByText("Font Size")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByText("Font Size")).not.toBeInTheDocument();
  });

  it("calls onChange when a setting is changed", () => {
    const onChange = vi.fn();
    render(
      <DiffSettingsPopover
        settings={defaultDiffSettings}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTitle("Diff settings"));
    fireEvent.click(screen.getByText("Split"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ diffMode: "split" }),
    );
  });

  it("highlights current setting value", () => {
    const settings: DiffSettings = { ...defaultDiffSettings, diffMode: "split" };
    render(
      <DiffSettingsPopover settings={settings} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTitle("Diff settings"));
    // Split button should have active class
    const splitBtn = screen.getByText("Split");
    expect(splitBtn).toHaveClass("bg-[#44475a]");
  });

  it("shows shiki note for highlight engine", () => {
    render(
      <DiffSettingsPopover
        settings={defaultDiffSettings}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Diff settings"));
    expect(screen.getByText("(reload req.)")).toBeInTheDocument();
  });
});
