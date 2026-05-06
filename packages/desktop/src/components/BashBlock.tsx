import { memo, useMemo, type ReactElement, type ReactNode } from "react";
import { Loader2Icon, TerminalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseAnsi } from "@/lib/ansi-to-html";
import { copyToClipboard } from "@/lib/clipboard";
import { CollapsibleBlock } from "@/components/ui/collapsible-block";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const DEFAULT_BASH_LINES = 10;

/** Insert line breaks before shell operators for readability in the header. */
function formatShellCommand(cmd: string): string {
  return cmd.replace(/\s+(&&|\|\||[;&|])\s*/g, "\n  $1 ");
}

export interface BashBlockProps {
  command?: string;
  content?: string;
  running?: boolean;
  isError?: boolean;
  maxLines?: number;
  bodyExtraClassName?: string;
  runningFooter?: ReactNode;
}

export const BashBlock = memo(function BashBlock({
  command,
  content,
  running,
  isError,
  maxLines = DEFAULT_BASH_LINES,
  bodyExtraClassName,
  runningFooter,
}: BashBlockProps): ReactElement {
  const lines = content?.split("\n") ?? [];
  const totalLines = lines.length;

  const hasOutput = typeof content === "string" && content.length > 0;
  const formattedCommand = useMemo(
    () => (command ? formatShellCommand(command) : undefined),
    [command],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="min-w-0 max-w-full">
          <CollapsibleBlock
            totalCount={totalLines}
            visibleCount={maxLines}
            unit="lines"
            className={isError ? "border-destructive/40" : "border-border"}
            headerClassName={cn(
              "bg-[var(--block-bash-header-bg)] py-1",
              isError ? "text-destructive" : "text-[var(--block-bash-muted-fg)]",
            )}
            toggleClassName="ml-auto text-[var(--block-bash-muted-fg)] hover:text-[var(--block-bash-fg)]"
            bodyClassName={cn(
              "px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono",
              "bg-[var(--block-bash-body-bg)]",
              isError ? "text-destructive" : "text-[var(--block-bash-fg)]",
              bodyExtraClassName,
            )}
            truncationClassName="text-[var(--block-bash-muted-fg)]/70"
            header={
              <>
                <TerminalIcon className="size-3 shrink-0" />
                <span className="font-medium text-[var(--block-bash-fg)]">Bash</span>
                <pre className="font-mono whitespace-pre-wrap break-all">
                  {formattedCommand ?? "Running command…"}
                </pre>
              </>
            }
          >
            {({ showAll }) =>
              hasOutput ? (
                <BashBodyContent
                  content={content ?? ""}
                  maxLines={maxLines}
                  showAll={showAll}
                  running={running}
                  runningFooter={runningFooter}
                />
              ) : running ? (
                <div className="flex items-center gap-2 text-xs text-[var(--block-bash-muted-fg)]">
                  <Loader2Icon className="size-3 animate-spin" />
                  <span>Running…</span>
                </div>
              ) : (
                <div className="text-xs text-[var(--block-bash-muted-fg)]">No output</div>
              )
            }
          </CollapsibleBlock>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!hasOutput}
          onSelect={() => void copyToClipboard(content ?? "", "Output copied")}
        >
          Copy Output
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!command}
          onSelect={() => void copyToClipboard(command ?? "", "Command copied")}
        >
          Copy Command
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasOutput}
          onSelect={() =>
            void copyToClipboard(
              "```bash\n" + (content ?? "") + "\n```",
              "Copied as Markdown code block",
            )
          }
        >
          Copy as Markdown Code Block
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface BashBodyContentProps {
  content: string;
  maxLines: number;
  showAll: boolean;
  running?: boolean;
  runningFooter?: ReactNode;
}

function BashBodyContent({
  content,
  maxLines,
  showAll,
  running,
  runningFooter,
}: BashBodyContentProps): ReactElement {
  const truncatedAnsi = useMemo(
    () => parseAnsi(content.split("\n").slice(-maxLines).join("\n")),
    [content, maxLines],
  );
  const fullAnsi = useMemo(() => (showAll ? parseAnsi(content) : null), [content, showAll]);
  return (
    <>
      <pre className="whitespace-pre">{showAll ? fullAnsi : truncatedAnsi}</pre>
      {running && runningFooter}
    </>
  );
}
