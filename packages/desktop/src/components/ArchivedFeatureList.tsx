import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Feature } from "@/api/generated";

interface ArchivedFeatureSectionProps {
  features: readonly Feature[];
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** The fold's name; "Dormant" reuses this section for idle conversations. */
  label?: string;
}

/** A folded group of a project's conversations behind a "Label (N)" divider. */
export function ArchivedFeatureSection({
  features,
  expanded,
  onToggle,
  children,
  label = "Archived",
}: ArchivedFeatureSectionProps) {
  if (features.length === 0) return null;
  return (
    <>
      <button
        type="button"
        data-feature-fold={label.toLowerCase()}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
      >
        <span className="flex-1 border-t border-border/50" />
        {expanded ? (
          <ChevronDownIcon className="size-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="size-3 shrink-0" />
        )}
        <span className="shrink-0">
          {label} ({features.length})
        </span>
        <span className="flex-1 border-t border-border/50" />
      </button>
      {expanded && children}
    </>
  );
}

export function ArchivedFeatureList({
  features,
  expanded,
  onToggle,
  renderFeature,
}: Omit<ArchivedFeatureSectionProps, "children"> & {
  renderFeature: (feature: Feature) => ReactNode;
}) {
  return (
    <ArchivedFeatureSection features={features} expanded={expanded} onToggle={onToggle}>
      <div className="max-h-[calc(5*2.25rem)] overflow-y-auto">
        {features.map((feature) => renderFeature(feature))}
      </div>
    </ArchivedFeatureSection>
  );
}
