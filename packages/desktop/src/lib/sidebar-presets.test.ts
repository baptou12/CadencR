import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEBAR_CONFIG, LEGACY_PROVIDER_LOGOS_KEY } from "./sidebar-config";
import { matchSidebarPreset, SIDEBAR_PRESETS, sidebarPresetValues } from "./sidebar-presets";

describe("sidebar presets", () => {
  it("makes Classic the defaults", () => {
    expect(matchSidebarPreset(DEFAULT_SIDEBAR_CONFIG)).toBe("classic");
    expect(Object.values(sidebarPresetValues("classic")).every((value) => value === null)).toBe(
      true,
    );
  });

  it("recognizes each preset and nothing once an option is customized", () => {
    for (const preset of SIDEBAR_PRESETS) {
      expect(matchSidebarPreset({ ...DEFAULT_SIDEBAR_CONFIG, ...preset.overrides })).toBe(
        preset.id,
      );
    }
    expect(matchSidebarPreset({ ...DEFAULT_SIDEBAR_CONFIG, density: "spacious" })).toBeNull();
  });

  it("leaves behaviour switches out of presets", () => {
    expect(matchSidebarPreset({ ...DEFAULT_SIDEBAR_CONFIG, typeToFilter: false })).toBe("classic");
    const values = sidebarPresetValues("minimal");
    expect(values).not.toHaveProperty("sidebar_type_to_filter");
    expect(values).not.toHaveProperty("sidebar_reveal_active");
    expect(values).not.toHaveProperty("sidebar_gate_popover");
    expect(values).not.toHaveProperty("sidebar_auto_collapse");
    expect(matchSidebarPreset({ ...DEFAULT_SIDEBAR_CONFIG, gatePopover: "click" })).toBe("classic");
  });

  it("sets and clears the block switches with the rest", () => {
    expect(sidebarPresetValues("control")).toMatchObject({
      sidebar_block_working: "true",
      sidebar_block_recent: null,
    });
    expect(sidebarPresetValues("minimal")).toMatchObject({
      sidebar_block_counts: "dot",
      sidebar_flash_on_change: "false",
    });
  });

  it("writes a preset's own values and clears every other key", () => {
    const values = sidebarPresetValues("dense");
    expect(values).toMatchObject({
      sidebar_density: "compact",
      sidebar_title_lines: "two",
      sidebar_row_branch: "true",
      sidebar_row_time: null,
      [LEGACY_PROVIDER_LOGOS_KEY]: null,
    });
  });
});
