import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import type { Feature } from "@/api/generated";
import type { FeatureTreeNode } from "@/lib/feature-hierarchy";
import { Button } from "@/components/ui/button";

/**
 * Renders an active-feature subtree as a compact, IDE-style indent tree:
 * a chevron twisty on parents and a single left guide rail per nesting
 * level. ProjectFeatureRow reserves the twisty gutter on every row so
 * siblings stay aligned whether or not they have children.
 */
export function FeatureSubtree({
  node,
  renderFeature,
}: {
  node: FeatureTreeNode;
  renderFeature: (feature: Feature, hierarchyControl?: ReactNode) => ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  const control = hasChildren ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-3.5 rounded-sm text-muted-foreground/70 hover:text-foreground"
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
      {renderFeature(node.feature, control)}
      {expanded && hasChildren && (
        <div data-feature-subtree-children={node.feature.id} className="relative ml-[11px] pl-2">
          {/* Guide rail centered under the parent chevron:
              pl-3 (12px) + half of size-3.5 (7px) = 19px from the row edge.
              ml-[11px] + left-2 (8px) = 19px. Shallow indent so deep chains
              don't march off to the right. */}
          <span aria-hidden className="absolute inset-y-0 left-2 w-px bg-sidebar-border" />
          {node.children.map((child) => (
            <FeatureSubtree key={child.feature.id} node={child} renderFeature={renderFeature} />
          ))}
        </div>
      )}
    </>
  );
}
