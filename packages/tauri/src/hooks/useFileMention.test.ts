import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useFileMention } from "./useFileMention";

const files = ["src/index.ts", "src/utils/helper.ts", "src/components/Button.tsx", "README.md"];

describe("useFileMention", () => {
  it("starts closed", () => {
    const { result } = renderHook(() => useFileMention(files));
    expect(result.current.isOpen).toBe(false);
    expect(result.current.filteredItems).toEqual([]);
  });

  it("opens when @ is typed at start", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@", 1);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.query).toBe("");
  });

  it("opens with query when @src is typed", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@src", 4);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.query).toBe("src");
    expect(result.current.filteredItems.length).toBeGreaterThan(0);
    expect(result.current.filteredItems.every((i) => i.path.toLowerCase().includes("src"))).toBe(
      true,
    );
  });

  it("includes directories in items", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@", 1);
    });
    const dirs = result.current.filteredItems.filter((i) => i.isDir);
    expect(dirs.length).toBeGreaterThan(0);
    expect(dirs[0].path.endsWith("/")).toBe(true);
  });

  it("closes on close()", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@src", 4);
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("closes when text does not start with @", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@src", 4);
    });
    act(() => {
      result.current.handleChange("hello", 5);
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("closes when @ is not at start or after whitespace", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("foo@bar", 7);
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("confirm inserts selected file path", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@README", 7);
    });
    let confirmed: { newText: string; newCursorPos: number } | null = null;
    act(() => {
      confirmed = result.current.confirm("@README");
    });
    expect(confirmed).not.toBeNull();
    expect(confirmed!.newText).toContain("README.md");
    expect(result.current.isOpen).toBe(false);
  });

  it("confirm returns null when not open", () => {
    const { result } = renderHook(() => useFileMention(files));
    const res = result.current.confirm("hello");
    expect(res).toBeNull();
  });

  it("handles ArrowDown navigation", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@", 1);
    });
    const initial = result.current.selectedIndex;
    act(() => {
      result.current.handleKeyDown(
        { key: "ArrowDown", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
        "@",
      );
    });
    expect(result.current.selectedIndex).toBe((initial + 1) % result.current.filteredItems.length);
  });

  it("handles ArrowUp navigation", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@", 1);
    });
    act(() => {
      result.current.handleKeyDown(
        { key: "ArrowDown", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
        "@",
      );
    });
    const afterDown = result.current.selectedIndex;
    act(() => {
      result.current.handleKeyDown(
        { key: "ArrowUp", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
        "@",
      );
    });
    expect(result.current.selectedIndex).toBe(
      (afterDown - 1 + result.current.filteredItems.length) % result.current.filteredItems.length,
    );
  });

  it("handles Escape to close", () => {
    const { result } = renderHook(() => useFileMention(files));
    act(() => {
      result.current.handleChange("@", 1);
    });
    act(() => {
      result.current.handleKeyDown(
        { key: "Escape", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
        "@",
      );
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("returns false from handleKeyDown when not open", () => {
    const { result } = renderHook(() => useFileMention(files));
    const res = result.current.handleKeyDown(
      { key: "ArrowDown", preventDefault: () => {} } as React.KeyboardEvent<HTMLTextAreaElement>,
      "",
    );
    expect(res).toBe(false);
  });

  it("handles undefined files gracefully", () => {
    const { result } = renderHook(() => useFileMention(undefined));
    act(() => {
      result.current.handleChange("@", 1);
    });
    expect(result.current.filteredItems).toEqual([]);
  });
});
