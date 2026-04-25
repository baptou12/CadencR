import { describe, it, expect } from "vitest";
import { render, screen } from "@/test-utils";
import { DiffHeader } from "./DiffHeader";

describe("DiffHeader", () => {
  it("renders file count", () => {
    render(<DiffHeader fileCount={3} totalAdditions={10} totalDeletions={5} />);
    expect(screen.getByText(/3 files changed/)).toBeInTheDocument();
  });

  it("renders singular 'file' for count=1", () => {
    render(<DiffHeader fileCount={1} totalAdditions={2} totalDeletions={1} />);
    expect(screen.getByText(/1 file changed/)).toBeInTheDocument();
  });

  it("renders additions and deletions", () => {
    render(<DiffHeader fileCount={2} totalAdditions={42} totalDeletions={7} />);
    expect(screen.getByText("+42")).toBeInTheDocument();
    expect(screen.getByText("-7")).toBeInTheDocument();
  });

  it("renders children in the right section", () => {
    render(
      <DiffHeader fileCount={1} totalAdditions={0} totalDeletions={0}>
        <button>Settings</button>
      </DiffHeader>,
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});
