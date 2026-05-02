import { memo, useState } from "react";
import type { ReactElement } from "react";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  content: string;
  cacheKey?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  cacheKey,
}: ThinkingBlockProps): ReactElement | null {
  const [expanded, setExpanded] = useState(true);
  if (!content.trim()) return null;

  // Thinking is the agent's internal monologue — distinct from primary
  // (purple) tool/plan blocks. Header reads in vivid pink (`--acc-pink`) for
  // a punchy, recognizable identity in both themes; the body stays at
  // opacity-75 so any markdown children (paragraphs, code, lists) inherit
  // a muted feel uniformly without losing the colorful header.
  return (
    <div className="my-1 rounded-md border border-[var(--acc-pink)]/25 bg-[var(--acc-pink)]/8">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <BrainIcon className="size-3 text-[var(--acc-pink)]" />
        <span className="font-medium text-[var(--acc-pink)]">Thinking</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-[var(--acc-pink)]/20 px-3 py-2 opacity-75">
          <Markdown
            content={content}
            cacheKey={cacheKey}
            className="text-xs text-muted-foreground"
          />
        </div>
      )}
    </div>
  );
});
