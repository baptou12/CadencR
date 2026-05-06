import type { FeatureStatus } from "@/hooks/useFeatureState";

export type { FeatureStatus };

/** The set of valid feature statuses, in canonical display order. */
export const STATUSES: readonly FeatureStatus[] = [
  "draft",
  "planned",
  "in-progress",
  "done",
  "archived",
];

/** Tailwind classes for rendering a feature status as a subtle colored chip. */
export const STATUS_COLORS: Record<FeatureStatus, string> = {
  draft: "bg-gray-500/15 text-gray-300",
  planned: "bg-blue-500/15 text-blue-300",
  "in-progress": "bg-yellow-500/15 text-yellow-300",
  done: "bg-green-500/15 text-green-300",
  archived: "bg-gray-500/15 text-gray-400",
};
