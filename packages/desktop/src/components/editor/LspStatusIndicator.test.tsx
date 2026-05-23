import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { LspStatusIndicator } from "./LspStatusIndicator";

describe("LspStatusIndicator", () => {
  it("labels the trigger with the heading for unsupported files", () => {
    render(<LspStatusIndicator status="unsupported" languageId={null} />);
    expect(screen.getByRole("button", { name: "No language server" })).toBeInTheDocument();
  });

  it("labels the trigger with the heading for the ready state", () => {
    render(<LspStatusIndicator status="ready" languageId="typescript" />);
    expect(screen.getByRole("button", { name: "Language server ready" })).toBeInTheDocument();
  });

  it("shows the resolved languageId in the ready popover", () => {
    render(<LspStatusIndicator status="ready" languageId="rust" />);
    fireEvent.click(screen.getByRole("button"));
    // Popover renders in a portal; query global document.
    expect(document.body).toHaveTextContent(/cmd-click a symbol/i);
    expect(document.body).toHaveTextContent(/rust/);
  });

  it("shows the spinner heading while starting", () => {
    render(<LspStatusIndicator status="starting" languageId="typescript" />);
    expect(screen.getByRole("button", { name: "Starting language server…" })).toBeInTheDocument();
  });

  it("surfaces the backend errorMessage verbatim on error", () => {
    const detail = "rust-analyzer not found in PATH or well-known dirs";
    render(<LspStatusIndicator status="error" languageId="rust" errorMessage={detail} />);
    fireEvent.click(screen.getByRole("button", { name: "Language server failed" }));
    expect(document.body).toHaveTextContent(detail);
  });

  it("falls back to a generic message when error has no detail", () => {
    render(<LspStatusIndicator status="error" languageId="rust" />);
    fireEvent.click(screen.getByRole("button", { name: "Language server failed" }));
    expect(document.body).toHaveTextContent(/install hint/i);
  });
});
