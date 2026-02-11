import { useState } from "react";
import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentPanel } from "./AgentPanel";
import type { AgentStatus } from "./AgentPanel";
import type { AgentBlockData } from "./AgentBlock";
import type { AgentType } from "../../main/agents/types";
import type { AgentQuestion } from "./AgentQuestionDrawer";

export interface AgentGridItem {
  agentType: AgentType;
  status: AgentStatus;
  blocks: AgentBlockData[];
  pendingQuestions?: AgentQuestion[];
  onQuestionResponse?: (response: string) => void;
}

interface AgentGridProps {
  agents: AgentGridItem[];
  className?: string;
}

function getGridClass(count: number, focusedIndex: number | null): string {
  if (focusedIndex !== null) {
    return "grid-cols-1 grid-rows-1";
  }
  if (count === 1) return "grid-cols-1 grid-rows-1";
  if (count === 2) return "grid-cols-2 grid-rows-1";
  if (count <= 4) return "grid-cols-2 grid-rows-2";
  return "grid-cols-3 auto-rows-fr";
}

export function AgentGrid({ agents, className }: AgentGridProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  if (agents.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-sm text-muted-foreground", className)}>
        No active agents
      </div>
    );
  }

  const isScrollable = focusedIndex === null && agents.length > 4;
  const gridClass = getGridClass(agents.length, focusedIndex);

  return (
    <div
      className={cn(
        "grid gap-2 p-2",
        gridClass,
        isScrollable ? "overflow-y-auto" : "h-full",
        !isScrollable && "h-full",
        className
      )}
    >
      {agents.map((agent, index) => {
        if (focusedIndex !== null && focusedIndex !== index) {
          return null;
        }

        return (
          <div key={agent.agentType} className="relative min-h-0 min-w-0">
            <AgentPanel
              agentType={agent.agentType}
              status={agent.status}
              blocks={agent.blocks}
              pendingQuestions={agent.pendingQuestions}
              onQuestionResponse={agent.onQuestionResponse}
              className="h-full"
            />
            {agents.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-8 top-1.5 size-7"
                onClick={() =>
                  setFocusedIndex(focusedIndex === index ? null : index)
                }
                title={focusedIndex === index ? "Return to grid" : "Focus this agent"}
              >
                {focusedIndex === index ? (
                  <MinimizeIcon className="size-3.5" />
                ) : (
                  <MaximizeIcon className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
