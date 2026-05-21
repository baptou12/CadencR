import { memo, useMemo } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import { AgentStreamItem } from "@/components/agent-session/AgentStreamItem";
import type { AgentVerbosityMode } from "@/lib/agent-verbosity";

interface MasonryRow {
  id: string;
  blocks: AgentBlockData[];
}

interface AgentMasonryStreamProps {
  blocks: AgentBlockData[];
  isStreaming?: boolean;
  basePath?: string;
  toolResultMap: Map<string, AgentBlockData>;
  verbosityMode?: AgentVerbosityMode;
}

function isTextLikeBlock(block: AgentBlockData): boolean {
  return block.type === "text" || block.type === "user_message" || block.type === "thinking";
}

function buildRows(blocks: AgentBlockData[]): MasonryRow[] {
  const rows: MasonryRow[] = [];
  let buffer: AgentBlockData[] = [];

  const flushBuffer = () => {
    if (buffer.length === 0) return;
    rows.push({ id: `tools-${buffer[0].id}`, blocks: buffer });
    buffer = [];
  };

  for (const block of blocks) {
    if (isTextLikeBlock(block)) {
      flushBuffer();
      rows.push({ id: `text-${block.id}`, blocks: [block] });
      continue;
    }
    buffer.push(block);
  }
  flushBuffer();
  return rows;
}

export const AgentMasonryStream = memo(function AgentMasonryStream({
  blocks,
  isStreaming,
  basePath,
  toolResultMap,
  verbosityMode = "maximal",
}: AgentMasonryStreamProps) {
  const rows = useMemo(() => buildRows(blocks), [blocks]);
  return (
    <div className="h-full overflow-y-auto px-1">
      <div className="space-y-2 pb-4">
        {rows.map((row) =>
          row.blocks.length === 1 ? (
            <AgentStreamItem
              key={row.id}
              block={row.blocks[0]}
              isStreaming={isStreaming}
              basePath={basePath}
              toolResultMap={toolResultMap}
              verbosityMode={verbosityMode}
            />
          ) : (
            <div key={row.id} className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {row.blocks.map((block) => (
                <AgentStreamItem
                  key={block.id}
                  block={block}
                  isStreaming={isStreaming}
                  basePath={basePath}
                  toolResultMap={toolResultMap}
                  verbosityMode={verbosityMode}
                />
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
});

