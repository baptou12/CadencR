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

  // Colors come straight from the theme:
  //   - `--block-bash-header-bg` / `--block-bash-body-bg`: surfaces
  //   - `--block-bash-fg`: terminal "white" — the Bash label and the body
  //     output's default text.
  //   - `--block-bash-muted-fg`: dimmer terminal text — the rendered
  //     command line, the toggle, the running/empty placeholders.
  // No Tailwind shades, no opacity tricks — themes own every color.
  return (
    <CollapsibleBlock
      totalCount={totalLines}
      visibleCount={DEFAULT_BASH_LINES}
      unit="lines"
      className={isError ? "border-destructive/40" : "border-border"}
      headerClassName={
        isError
          ? "bg-destructive/10 text-destructive py-1"
          : "bg-[var(--block-bash-header-bg)] text-[var(--block-bash-muted-fg)] py-1"
      }
      toggleClassName="ml-auto text-[var(--block-bash-muted-fg)] hover:text-[var(--block-bash-fg)]"
      bodyClassName={cn(
        "px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono",
        "bg-[var(--block-bash-body-bg)]",
        isError ? "text-destructive" : "text-[var(--block-bash-fg)]",
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
      {({ showAll }) => (
        <>
          {hasOutput ? (
            <pre className="whitespace-pre-wrap">
              {showAll ? parseAnsi(content) : truncatedAnsi}
            </pre>
          ) : running ? (
            <div className="flex items-center gap-2 text-xs text-[var(--block-bash-muted-fg)]">
              <Loader2Icon className="size-3 animate-spin" />
              <span>Running…</span>
            </div>
          ) : (
            <div className="text-xs text-[var(--block-bash-muted-fg)]">No output</div>
          )}
        </>
      )}
    </CollapsibleBlock>
  );
});
