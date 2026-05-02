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

  return (
    <div className="my-1 rounded-md border border-border bg-purple-500/5">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs"
        onClick={() => setExpanded(!expanded)}
      >
        <BrainIcon className="size-3 text-purple-400" />
        <span className="font-medium text-purple-300">Thinking</span>
        <ChevronRightIcon
          className={cn(
            "ml-auto size-3 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2">
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
