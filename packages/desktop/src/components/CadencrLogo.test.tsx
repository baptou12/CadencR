import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test-utils";
import { CadencrLogo } from "./CadencrLogo";

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    themeId: "aurora",
    theme: {
      logo: {
        src: "aurora-light-logo.svg",
        alt: "Cadencr",
        variant: "light",
        displayScale: 1.24,
      },
    },
    setTheme: vi.fn(),
    isLoading: false,
  }),
}));

describe("CadencrLogo", () => {
  it("uses the active theme logo and its display scale", () => {
    render(<CadencrLogo className="size-11" />);

    const logo = screen.getByAltText("Cadencr");
    expect(logo).toHaveAttribute("src", "aurora-light-logo.svg");
    expect(logo).toHaveStyle({ transform: "scale(1.24)" });
  });
});
