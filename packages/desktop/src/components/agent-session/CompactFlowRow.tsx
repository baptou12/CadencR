import { memo } from "react";
import type { AgentBlockData } from "@/components/AgentBlock";
import { CompactToolTile } from "./CompactToolTile";

interface CompactFlowRowProps {
  blocks: AgentBlockData[];
  basePath?: string;
}

/**
 * Renders a group of consecutive non-text blocks as a flex-wrap of tiles
 * (the "Compact flow" verbosity mode). Tiles are content-sized — Bash shows
 * a command head, file-change tools show a numstat, others show the tool
 * name — so a row can naturally hold a different number of tiles depending
 * on content length.
 */
export const CompactFlowRow = memo(function CompactFlowRow({
  blocks,
  basePath,
}: CompactFlowRowProps) {
  return (
    <div className="my-1 flex flex-wrap items-center gap-1.5 py-0.5">
      {blocks.map((block) => (
        <CompactToolTile key={block.id} block={block} basePath={basePath} />
      ))}
    </div>
  );
});
