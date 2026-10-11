import type { SegmentedOption } from "@/components/usage/UsageSegmentedControl";
import type { SidebarConfig, SidebarOptionId } from "@/lib/sidebar-config";

/**
 * The sidebar display options as the popover and the Settings section lay them
 * out: one segmented control per choice, one checkbox per row element, one
 * switch per block or behaviour.
 */

export type ChoiceId = {
  [K in SidebarOptionId]: SidebarConfig[K] extends string ? K : never;
}[SidebarOptionId];
export type ToggleId = {
  [K in SidebarOptionId]: SidebarConfig[K] extends boolean ? K : never;
}[SidebarOptionId];

export interface ChoiceRow<K extends ChoiceId> {
  id: K;
  label: string;
  /** Shown on the Settings page, where there is room to explain. */
  description: string;
  options: readonly SegmentedOption<SidebarConfig[K]>[];
}

// Mapped per key, so each row's options must be that option's own values.
export const CHOICE_ROWS: readonly { [K in ChoiceId]: ChoiceRow<K> }[ChoiceId][] = [
  {
    id: "density",
    description: "Height of each row: 28, 36 or 44 px.",
    label: "Density",
    options: [
      { value: "compact", label: "Compact" },
      { value: "comfortable", label: "Comfortable" },
      { value: "spacious", label: "Spacious" },
    ],
  },
  {
    id: "fontSize",
    description: "Size of conversation titles, in pixels.",
    label: "Text size",
    options: [
      { value: "12", label: "12" },
      { value: "12.5", label: "12.5" },
      { value: "13", label: "13" },
      { value: "14", label: "14" },
    ],
  },
  {
    id: "titleLines",
    description: "How much of a long title shows.",
    label: "Title",
    options: [
      { value: "one", label: "1 line" },
      { value: "two", label: "2 lines" },
      { value: "hover", label: "Full on hover", title: "One line, the full title on hover" },
    ],
  },
  {
    id: "titleSource",
    description: "Lead with the conversation title, its worktree branch, or its worktree folder.",
    label: "Title from",
    options: [
      { value: "title", label: "Title" },
      { value: "branch", label: "Branch", title: "The worktree branch, else the title" },
      { value: "folder", label: "Folder", title: "The worktree folder, else the title" },
    ],
  },
  {
    id: "status",
    description:
      "How working, unread and idle conversations show. Pending requests and failures always show.",
    label: "Status",
    options: [
      { value: "shape", label: "Shape" },
      { value: "dot", label: "Dot" },
      { value: "hidden", label: "Hidden", title: "Pending requests and failures stay visible" },
    ],
  },
  {
    id: "time",
    description: "Last activity on each row. Hovering a row swaps it for the row actions.",
    label: "Time",
    options: [
      { value: "none", label: "None" },
      { value: "relative", label: "Relative" },
      { value: "absolute", label: "Absolute" },
    ],
  },
  {
    id: "label",
    description: "How a conversation label shows under its title.",
    label: "Label",
    options: [
      { value: "chip", label: "Chip" },
      { value: "dot", label: "Dot" },
      { value: "hidden", label: "Hidden" },
    ],
  },
  {
    id: "provider",
    description:
      "The harness logo at the end of each row, optionally with the model under the title.",
    label: "Provider",
    options: [
      { value: "logo", label: "Logo" },
      { value: "logo_model", label: "Logo + model" },
      { value: "hidden", label: "Hidden" },
    ],
  },
  {
    id: "projectBadges",
    description:
      "What a collapsed project shows: pending requests and failures as strong pills, working agents and unread replies as quiet marks.",
    label: "Project badges",
    options: [
      { value: "count", label: "Count" },
      { value: "dot", label: "Dot", title: "One mark per state, without numbers" },
      { value: "none", label: "None" },
    ],
  },
  {
    id: "dormantAfter",
    description:
      "Fold conversations idle for this long into a Dormant section. Open, working, waiting and unread ones always stay.",
    label: "Fold idle after",
    options: [
      { value: "never", label: "Never" },
      { value: "3", label: "3d" },
      { value: "7", label: "7d" },
      { value: "14", label: "14d" },
      { value: "30", label: "30d" },
    ],
  },
  {
    id: "revealActive",
    description: "When a conversation opens, expand its project and scroll its row into view.",
    label: "Reveal open",
    options: [
      { value: "scroll", label: "Scroll" },
      { value: "expand", label: "Expand", title: "Expand its project without scrolling" },
      { value: "off", label: "Off" },
    ],
  },
  {
    id: "rail",
    description: "What stays visible when the sidebar is collapsed.",
    label: "Collapsed rail",
    options: [
      { value: "projects", label: "Projects" },
      {
        value: "conversations",
        label: "Active",
        title: "Every conversation with something going on",
      },
      { value: "attention", label: "Attention", title: "Only conversations waiting on you" },
      { value: "none", label: "None" },
    ],
  },
  {
    id: "gatePopover",
    description:
      "When a pending request's popover opens: by itself on the newest request, on pointing at its icon, or only on a click.",
    label: "Gate popover",
    options: [
      { value: "auto", label: "Auto", title: "Opens by itself on the newest pending request" },
      { value: "hover", label: "Hover", title: "Opens while you point at the pending icon" },
      { value: "click", label: "Click", title: "Opens only when you click the pending icon" },
    ],
  },
  {
    id: "blockCounts",
    description: "What the For me, In progress and Pinned headers show next to their name.",
    label: "Block counters",
    options: [
      { value: "count", label: "Count" },
      { value: "dot", label: "Dot", title: "A dot, amber when something needs an action" },
      { value: "none", label: "None" },
    ],
  },
  {
    id: "recentCount",
    description: "How many conversations the Recent block lists.",
    label: "Recent shows",
    options: [
      { value: "3", label: "3" },
      { value: "5", label: "5" },
      { value: "10", label: "10" },
    ],
  },
];

/** The on/off switches, after the choices. */
export const SWITCH_ROWS: readonly { id: ToggleId; label: string; description: string }[] = [
  {
    id: "forMe",
    label: "For me block",
    description:
      "Conversations waiting on you, failed or unread, across every project, oldest first.",
  },
  {
    id: "workingBlock",
    label: "In progress block",
    description: "Every agent at work, across every project.",
  },
  {
    id: "recentBlock",
    label: "Recent block",
    description: "The conversations you touched last, across every project.",
  },
  {
    id: "hideEmptyBlocks",
    label: "Hide empty blocks",
    description: "A block with nothing in it disappears instead of saying so.",
  },
  {
    id: "flashOnChange",
    label: "Flash on change",
    description: "A row flashes once when its conversation starts waiting, fails or replies.",
  },
  {
    id: "autoCollapse",
    label: "Auto-collapse",
    description:
      "Fold the sidebar away while the window is narrower than 1024 px; it comes back when the window widens.",
  },
  {
    id: "typeToFilter",
    label: "Type to filter",
    description:
      "Typing while a sidebar row has focus filters conversations. Escape clears the filter.",
  },
];

export const PRESET_DESCRIPTION =
  "Classic is the default. Picking a preset resets every display option it doesn't set; changing any of them makes it yours.";

export const ROW_ELEMENTS_DESCRIPTION =
  "The worktree marker on the title line, and the details on the line under it.";

export const ROW_ELEMENTS: readonly { id: ToggleId; label: string; description: string }[] = [
  {
    id: "pendingRequest",
    label: "Pending request",
    description: "Under a waiting row, what it asks for: the command to allow or the question.",
  },
  {
    id: "worktreeIcon",
    label: "Worktree icon",
    description: "A branch glyph before the title when the conversation has its own worktree.",
  },
  {
    id: "branch",
    label: "Branch",
    description: "The worktree branch, under the title.",
  },
  {
    id: "diff",
    label: "Diff stats",
    description: "Lines added and removed in the worktree, under the title.",
  },
  {
    id: "pr",
    label: "Pull request",
    description: "The pull request opened from the conversation and its state, under the title.",
  },
  {
    id: "ports",
    label: "Ports",
    description:
      "Ports the conversation's processes listen on, under the title. Click one to open it.",
  },
  {
    id: "activity",
    label: "Shells & tabs",
    description: "Open shells, browser tabs and downloads, under the title.",
  },
];

/** One line of the display options: an option, the presets, or the row element checkboxes. */
export type DisplayItem = SidebarOptionId | "preset" | "rowElements";

export interface DisplayGroup {
  id: string;
  label: string;
  items: readonly DisplayItem[];
}

/**
 * The options in the order both layouts show them: what changes the sidebar
 * most first, the rest grouped by what they act on. The popover folds every
 * group after the first.
 */
export const DISPLAY_GROUPS: readonly DisplayGroup[] = [
  { id: "essentials", label: "Essentials", items: ["preset", "density", "status", "time"] },
  {
    id: "rows",
    label: "Rows",
    items: ["fontSize", "titleLines", "titleSource", "label", "provider", "rowElements"],
  },
  {
    id: "blocks",
    label: "Blocks",
    items: [
      "forMe",
      "workingBlock",
      "recentBlock",
      "recentCount",
      "blockCounts",
      "hideEmptyBlocks",
    ],
  },
  { id: "projects", label: "Projects", items: ["projectBadges", "dormantAfter", "revealActive"] },
  { id: "attention", label: "Attention", items: ["gatePopover", "flashOnChange"] },
  {
    id: "collapsing",
    label: "Collapsing & filter",
    items: ["rail", "autoCollapse", "typeToFilter"],
  },
];

const CHOICE_BY_ID = new Map<string, (typeof CHOICE_ROWS)[number]>(
  CHOICE_ROWS.map((row) => [row.id, row]),
);
const SWITCH_BY_ID = new Map<string, (typeof SWITCH_ROWS)[number]>(
  SWITCH_ROWS.map((row) => [row.id, row]),
);

/** What a group item renders: a segmented choice, a switch, or one of the two composite lines. */
export function resolveDisplayItem(
  item: DisplayItem,
):
  | { kind: "choice"; row: (typeof CHOICE_ROWS)[number] }
  | { kind: "switch"; row: (typeof SWITCH_ROWS)[number] }
  | { kind: "preset" }
  | { kind: "rowElements" } {
  if (item === "preset") return { kind: "preset" };
  if (item === "rowElements") return { kind: "rowElements" };
  const choice = CHOICE_BY_ID.get(item);
  if (choice) return { kind: "choice", row: choice };
  const toggle = SWITCH_BY_ID.get(item);
  if (toggle) return { kind: "switch", row: toggle };
  throw new Error(`Sidebar option ${item} has no display row`);
}
