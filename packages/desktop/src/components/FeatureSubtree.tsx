import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Feature } from "@/api/generated";
import type { FeatureTreeNode } from "@/lib/feature-hierarchy";
import { Button } from "@/components/ui/button";

/**
 * Renders an active-feature subtree as a compact, IDE-style indent tree:
 * a chevron twisty on parents and an explicit depth passed to each row.
 * ProjectFeatureRow applies that depth inside the full-width hover target,
 * so siblings stay aligned without guide rails.
 */
export function FeatureSubtree({
  node,
  renderFeature,
  depth = 0,
}: {
  node: FeatureTreeNode;
  renderFeature: (feature: Feature, hierarchyControl?: ReactNode, depth?: number) => ReactNode;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  const control = hasChildren ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-3 rounded-sm text-muted-foreground/70 hover:text-foreground"
      aria-label={expanded ? "Collapse child sessions" : "Expand child sessions"}
      onClick={(event) => {
        event.stopPropagation();
        setExpanded((value) => !value);
      }}
    >
      {expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
    </Button>
  ) : null;

  return (
    <>
      {renderFeature(node.feature, control, depth)}
      {expanded && hasChildren && (
        <div data-feature-subtree-children={node.feature.id}>
          {node.children.map((child) => (
            <FeatureSubtree
              key={child.feature.id}
              node={child}
              renderFeature={renderFeature}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </>
  );
}
