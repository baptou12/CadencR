import { memo, useMemo } from "react";
import type { ReactElement } from "react";
import { Loader2Icon, TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseAnsi } from "@/lib/ansi-to-html";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";

const DEFAULT_BASH_LINES = 10;

interface BashBlockProps {
  command?: string;
  content?: string;
  running?: boolean;
  isError?: boolean;
}

function formatShellCommand(cmd: string): string {
  return cmd.replace(/\s+(&&|\|\||[;&|])\s*/g, "\n  $1 ");
}

export const BashBlock = memo(function BashBlock({
  command,
  content,
  running,
  isError,
}: BashBlockProps): ReactElement {
  const lines = content?.split("\n") ?? [];
  const totalLines = lines.length;
  const truncatedAnsi = useMemo(
    () => parseAnsi((content?.split("\n") ?? []).slice(-DEFAULT_BASH_LINES).join("\n")),
    [content],
  );
  const hasOutput = typeof content === "string" && content.length > 0;
  const formattedCommand = useMemo(
    () => (command ? formatShellCommand(command) : undefined),
    [command],
  );

  return (
    <CollapsibleBlock
      totalCount={totalLines}
      visibleCount={DEFAULT_BASH_LINES}
      unit="lines"
      className={isError ? "border-red-800" : "border-zinc-700"}
      headerClassName={isError ? "bg-red-950 text-red-400 py-1" : "bg-zinc-900 text-zinc-400 py-1"}
      toggleClassName="ml-auto text-zinc-500 hover:text-zinc-300"
      bodyClassName={cn(
        "bg-zinc-950 px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono",
        isError ? "text-red-300" : "text-zinc-300",
      )}
      truncationClassName="text-zinc-600"
      header={
        <>
          <TerminalIcon className="size-3 shrink-0" />
          <span className="font-medium text-zinc-300">Bash</span>
          <pre className="font-mono whitespace-pre-wrap break-all">
            {formattedCommand ?? "Running command…"}
          </pre>
        </>
      }
    >
      {({ showAll }) => (
        <>
          {hasOutput ? (
            <pre className="whitespace-pre-wrap">
              {showAll ? parseAnsi(content) : truncatedAnsi}
            </pre>
          ) : running ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2Icon className="size-3 animate-spin" />
              <span>Running…</span>
            </div>
          ) : (
            <div className="text-xs text-zinc-500">No output</div>
          )}
        </>
      )}
    </CollapsibleBlock>
  );
});
