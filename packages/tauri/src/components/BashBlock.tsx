import { memo, useMemo } from "react";
import type { ReactElement } from "react";
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

  // Color tokens go through the active theme — no hardcoded zinc/red shades.
  // The body matches the terminal/code surface (`--code-bg` / `--code-fg`) so
  // shell output reads as a terminal block in both Dracula and Aurora.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <CollapsibleBlock
            totalCount={totalLines}
            visibleCount={DEFAULT_BASH_LINES}
            unit="lines"
            className={isError ? "border-destructive/40" : "border-border"}
            headerClassName={
              isError
                ? "bg-destructive/10 text-destructive py-1"
                : "bg-muted text-muted-foreground py-1"
            }
            toggleClassName="ml-auto text-muted-foreground hover:text-foreground"
            bodyClassName={cn(
              "px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono",
              "bg-[var(--code-bg)]",
              isError ? "text-destructive" : "text-[var(--code-fg)]",
            )}
            truncationClassName="text-muted-foreground/60"
            header={
              <>
                <TerminalIcon className="size-3 shrink-0" />
                <span className="font-medium text-foreground">Bash</span>
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
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2Icon className="size-3 animate-spin" />
                    <span>Running…</span>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No output</div>
                )}
              </>
            )}
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
