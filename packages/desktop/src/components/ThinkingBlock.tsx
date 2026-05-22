import { memo, useState } from "react";
import type { ReactElement } from "react";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "@/components/ui/collapsible-section";

interface ThinkingBlockProps {
  content: string;
  cacheKey?: string;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  cacheKey,
  expanded,
  onExpandedChange,
}: ThinkingBlockProps): ReactElement | null {
  const [internalExpanded, setInternalExpanded] = useState(true);
  const isExpanded = expanded ?? internalExpanded;
  if (!content.trim()) return null;

  const toggleExpanded = () => {
    const next = !isExpanded;
    onExpandedChange?.(next);
    if (expanded === undefined) setInternalExpanded(next);
  };

  // The agent's internal monologue. Surface + accent come from the theme's
  // `--block-thinking-*` tokens; the outline uses the neutral `--border`
  // token so the colored bg can carry the identity without a loud border.
  return (
    <div className="my-1 rounded-md border border-border bg-[var(--block-thinking-bg)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={toggleExpanded}
      >
        <BrainIcon className="size-3 text-[var(--block-thinking-accent)]" />
        <span className="font-medium text-[var(--block-thinking-accent)]">Thinking</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 text-muted-foreground transition-transform",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      <CollapsibleSection open={isExpanded}>
        <div className="border-t border-border px-3 py-2">
          <Markdown
            content={content}
            cacheKey={cacheKey}
            className="text-xs text-muted-foreground"
          />
        </div>
      </CollapsibleSection>
    </div>
  );
});
