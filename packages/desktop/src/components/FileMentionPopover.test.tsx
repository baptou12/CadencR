import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { FileMentionPopover } from "./FileMentionPopover";

describe("FileMentionPopover", () => {
  it("renders children", () => {
    render(
      <FileMentionPopover
        open={false}
        items={[]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      >
        <input placeholder="Type here" />
      </FileMentionPopover>,
    );
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
  });

  it("does not show items when closed", () => {
    render(
      <FileMentionPopover
        open={false}
        items={[{ path: "src/index.ts", isDir: false }]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      >
        <input />
      </FileMentionPopover>,
    );
    expect(screen.queryByText("src/index.ts")).not.toBeInTheDocument();
  });

  it("shows file items when open", () => {
    render(
      <FileMentionPopover
        open={true}
        items={[
          { path: "src/app.ts", isDir: false },
          { path: "src/components", isDir: true },
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      >
        <input />
      </FileMentionPopover>,
    );
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("src/components")).toBeInTheDocument();
  });

  it("calls onSelect with path when item is clicked", async () => {
    const onSelect = vi.fn();
    const { user } = render(
      <FileMentionPopover
        open={true}
        items={[{ path: "src/utils.ts", isDir: false }]}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={vi.fn()}
      >
        <input />
      </FileMentionPopover>,
    );
    // Use pointer down since onMouseDown is used instead of onClick
    await user.pointer({ keys: "[MouseLeft>]", target: screen.getByText("src/utils.ts") });
    expect(onSelect).toHaveBeenCalledWith("src/utils.ts");
  });

  it("highlights the selected item", () => {
    render(
      <FileMentionPopover
        open={true}
        items={[
          { path: "file1.ts", isDir: false },
          { path: "file2.ts", isDir: false },
        ]}
        selectedIndex={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      >
        <input />
      </FileMentionPopover>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[1]).toHaveAttribute("data-selected", "true");
  });
});
