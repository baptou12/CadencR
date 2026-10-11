import type { SegmentedOption } from "@/components/usage/UsageSegmentedControl";
import type { SidebarConfig, SidebarOptionId } from "@/lib/sidebar-config";

/**
 * The sidebar display options as the popover and the Settings section lay them
 * out: one segmented control per choice, one checkbox per row element.
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
      { value: "dot", label: "Dot" },
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
];

export const ROW_ELEMENTS: readonly { id: ToggleId; label: string }[] = [
  { id: "pendingRequest", label: "Pending request" },
  { id: "worktreeIcon", label: "Worktree icon" },
  { id: "branch", label: "Branch" },
  { id: "diff", label: "Diff stats" },
  { id: "pr", label: "Pull request" },
  { id: "ports", label: "Ports" },
  { id: "activity", label: "Shells & tabs" },
];
