import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { MonoFontProvider } from "./MonoFontProvider";

vi.mock("./mono-font-setting", () => ({
  useMonoFont: () => ({
    family: "Fira Code",
    resolved: `"Fira Code", monospace`,
    setFamily: vi.fn(),
    isLoading: false,
  }),
}));

describe("MonoFontProvider", () => {
  it("writes the resolved stack to --font-mono and renders children", () => {
    const { getByText } = render(
      <MonoFontProvider>
        <span>child</span>
      </MonoFontProvider>,
    );
    expect(getByText("child")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(
      `"Fira Code", monospace`,
    );
  });
});
