import { memo, useMemo, type ReactNode } from "react";
import {
  BrainIcon,
  PencilIcon,
  TerminalIcon,
  WrenchIcon,
  FilePlusIcon,
  type LucideIcon,
} from "lucide-react";
import { cn, toRelativePath } from "@/lib/utils";
import type { AgentBlockData } from "@/components/AgentBlock";
import { NumStat } from "@/components/NumStat";
import { extractBashCommand, isFileChangeTool, normalizeToolName } from "@/lib/tool-adapter";
import { parseCadencrMcpTool } from "@/lib/tool-call-parser";
import { computeToolNumStat } from "@/lib/tool-numstat";
import { TOOL_ACCENT_CLASSES, type ToolAccent } from "@/lib/tool-accent";

interface CompactToolTileProps {
  block: AgentBlockData;
  basePath?: string;
}

/**
 * Single tile in the "Compact flow" verbosity mode. Each tile is a
 * content-sized pill — Bash shows the command head, file-change tools show
 * a numstat, thinking and other tools show just an icon + name. Tiles are
 * read-only summaries; switching to Maximal/Auto-collapse reveals the full
 * block content.
 */
export const CompactToolTile = memo(function CompactToolTile({
  block,
  basePath,
}: CompactToolTileProps) {
  if (block.type === "thinking") {
    return <BaseTile icon={BrainIcon} accent="thinking" label="Thinking" />;
  }
  if (block.type !== "tool_call") return null;
  return <CompactToolCallTile block={block} basePath={basePath} />;
});

function CompactToolCallTile({ block, basePath }: CompactToolTileProps) {
  const rawToolName = block.toolName ?? "Tool";
  const toolName = normalizeToolName(rawToolName);

  // Branch on toolName before any work — the heavier per-tool helpers
  // (`parseCadencrMcpTool`, patch stats, command shortening) only need to
  // run for the tile shape that actually consumes them. The `useMemo`s
  // below stay hook-stable because they're called unconditionally inside
  // each branch component.
  if (toolName === "Bash") {
    return <BashTile toolArgs={block.toolArgs} basePath={basePath} />;
  }
  if (isFileChangeTool(toolName)) {
    return (
      <FileChangeTile rawToolName={rawToolName} toolName={toolName} toolArgs={block.toolArgs} />
    );
  }
  return <GenericToolTile toolName={toolName} toolArgs={block.toolArgs} />;
}

function BashTile({
  toolArgs,
  basePath,
}: {
  toolArgs: string | undefined;
  basePath: string | undefined;
}) {
  const command = useMemo(() => extractBashCommand(toolArgs), [toolArgs]);
  const commandPreview = useMemo(
    () => (command ? shortenCommand(command, basePath) : ""),
    [command, basePath],
  );
  return (
    <BaseTile
      icon={TerminalIcon}
      accent="bash"
      label="Bash"
      detail={commandPreview ? `· ${commandPreview}` : undefined}
    />
  );
}

function FileChangeTile({
  rawToolName,
  toolName,
  toolArgs,
}: {
  rawToolName: string;
  toolName: string;
  toolArgs: string | undefined;
}) {
  const stats = useMemo(() => computeToolNumStat(rawToolName, toolArgs), [rawToolName, toolArgs]);
  if (!stats) return <BaseTile icon={WrenchIcon} accent="tool" label={toolName} />;
  const Icon = toolName === "Write" ? FilePlusIcon : PencilIcon;
  return (
    <BaseTile
      icon={Icon}
      accent="edit"
      label={toolName}
      trailing={<NumStat additions={stats.additions} deletions={stats.deletions} hideZero />}
    />
  );
}

function GenericToolTile({
  toolName,
  toolArgs,
}: {
  toolName: string;
  toolArgs: string | undefined;
}) {
  const cadencrMcp = useMemo(() => parseCadencrMcpTool(toolName, toolArgs), [toolName, toolArgs]);
  const label = cadencrMcp?.label ?? toolName;
  return <BaseTile icon={WrenchIcon} accent="tool" label={label} />;
}

interface BaseTileProps {
  icon: LucideIcon;
  accent: ToolAccent;
  label: string;
  /** Optional secondary text rendered next to the label (e.g. command head). */
  detail?: string;
  /** Optional trailing slot (e.g. NumStat). */
  trailing?: ReactNode;
}

function BaseTile({ icon: Icon, accent, label, detail, trailing }: BaseTileProps) {
  const classes = TOOL_ACCENT_CLASSES[accent];
  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
        classes.wrapper,
      )}
    >
      <Icon className={cn("size-3 shrink-0", classes.label)} />
      <span className={cn("font-medium", classes.label)}>{label}</span>
      {detail && (
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={detail}>
          {detail}
        </span>
      )}
      {trailing}
    </div>
  );
}

function shortenCommand(command: string, basePath: string | undefined): string {
  const single = command.replace(/\s+/g, " ").trim();
  const rel = toRelativePath(single, basePath);
  return rel.length > 80 ? `${rel.slice(0, 77)}…` : rel;
}
