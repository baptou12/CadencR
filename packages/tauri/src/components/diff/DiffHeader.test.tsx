import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test-utils";
import { DiffHeader, FileHeader } from "./DiffHeader";

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

describe("FileHeader", () => {
  it("renders file name", () => {
    render(
      <FileHeader
        fileName="src/foo/bar.ts"
        additions={5}
        deletions={2}
        isCollapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("src/foo/bar.ts")).toBeInTheDocument();
  });

  it("renders additions and deletions", () => {
    render(
      <FileHeader
        fileName="file.ts"
        additions={10}
        deletions={3}
        isCollapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByText("+10")).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("calls onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(
      <FileHeader
        fileName="file.ts"
        additions={0}
        deletions={0}
        isCollapsed={false}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
