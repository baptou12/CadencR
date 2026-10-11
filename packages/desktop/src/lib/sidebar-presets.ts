import {
  DEFAULT_SIDEBAR_CONFIG,
  LEGACY_PROVIDER_LOGOS_KEY,
  serializeSidebarOption,
  SIDEBAR_OPTIONS,
  type SidebarConfig,
  type SidebarOptionId,
} from "@/lib/sidebar-config";

export type SidebarPresetId = "classic" | "control" | "minimal" | "dense";

interface SidebarPreset {
  id: SidebarPresetId;
  label: string;
  description: string;
  /** What the preset changes from the defaults; every other display option is reset. */
  overrides: Partial<SidebarConfig>;
}

/**
 * Built-in sidebar presets (L1). Classic is the defaults, so it is also what a
 * new user gets. A preset is a full display configuration: applying one resets
 * every display option it doesn't set. Behaviour switches are left alone.
 */
export const SIDEBAR_PRESETS: readonly SidebarPreset[] = [
  {
    id: "classic",
    label: "Classic",
    description: "The defaults: comfortable rows, relative times, project badges.",
    overrides: {},
  },
  {
    id: "control",
    label: "Control tower",
    description:
      "For many agents at once: compact rows, an In progress block, attention-only rail, idle conversations folded after 3 days.",
    overrides: { density: "compact", rail: "attention", dormantAfter: "3", workingBlock: true },
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Titles and status only: no details under rows, no times, quiet dots, no flashes.",
    overrides: {
      status: "dot",
      time: "none",
      worktreeIcon: false,
      diff: false,
      pr: false,
      ports: false,
      activity: false,
      label: "hidden",
      provider: "hidden",
      projectBadges: "dot",
      blockCounts: "dot",
      flashOnChange: false,
      dormantAfter: "3",
    },
  },
  {
    id: "dense",
    label: "Dense pro",
    description:
      "Everything at a glance: compact two-line titles, branch, model, every detail, a Recent block.",
    overrides: {
      density: "compact",
      fontSize: "12",
      titleLines: "two",
      branch: true,
      provider: "logo_model",
      recentBlock: true,
    },
  },
];

/** How the sidebar behaves rather than looks: no preset sets or resets these. */
const BEHAVIOUR_OPTIONS: ReadonlySet<SidebarOptionId> = new Set([
  "typeToFilter",
  "revealActive",
  "gatePopover",
  "autoCollapse",
]);

const PRESET_OPTION_IDS = (Object.keys(SIDEBAR_OPTIONS) as SidebarOptionId[]).filter(
  (id) => !BEHAVIOUR_OPTIONS.has(id),
);

const PRESET_CONFIGS = SIDEBAR_PRESETS.map((preset) => ({
  id: preset.id,
  config: { ...DEFAULT_SIDEBAR_CONFIG, ...preset.overrides } satisfies SidebarConfig,
}));

/** The preset the display options match exactly, else null (customized). */
export function matchSidebarPreset(config: SidebarConfig): SidebarPresetId | null {
  const match = PRESET_CONFIGS.find((preset) =>
    PRESET_OPTION_IDS.every((id) => config[id] === preset.config[id]),
  );
  return match?.id ?? null;
}

/**
 * The batch write that applies a preset: its own values, and null for every
 * other display key (legacy switch included) so the defaults apply again.
 */
export function sidebarPresetValues(presetId: SidebarPresetId): Record<string, string | null> {
  const preset = SIDEBAR_PRESETS.find((candidate) => candidate.id === presetId);
  const overrides: Partial<Record<SidebarOptionId, string | boolean>> = preset?.overrides ?? {};
  const values: Record<string, string | null> = { [LEGACY_PROVIDER_LOGOS_KEY]: null };
  for (const id of PRESET_OPTION_IDS) {
    const value = overrides[id];
    values[SIDEBAR_OPTIONS[id].key] = value === undefined ? null : serializeSidebarOption(value);
  }
  return values;
}
