import { describe, it, expect, vi } from "vitest";

const mockUseGetProjectSettings = vi.fn();

vi.mock("@/api/generated", () => ({
  useGetProjectSettings: (id: number) => mockUseGetProjectSettings(id),
}));

import { useProjectColor } from "./useProjectColor";

describe("useProjectColor", () => {
  it("returns color from settings", () => {
    mockUseGetProjectSettings.mockReturnValue({
      data: [{ key: "color", value: "ff79c6" }],
    });
    expect(useProjectColor(1)).toBe("ff79c6");
  });

  it("returns default color when no color setting exists", () => {
    mockUseGetProjectSettings.mockReturnValue({
      data: [{ key: "branch_prefix", value: "feat/" }],
    });
    expect(useProjectColor(1)).toBe("3b82f6");
  });

  it("returns default color when settings are undefined", () => {
    mockUseGetProjectSettings.mockReturnValue({ data: undefined });
    expect(useProjectColor(1)).toBe("3b82f6");
  });
});
