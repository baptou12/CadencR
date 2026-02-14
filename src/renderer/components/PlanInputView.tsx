import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2Icon } from "lucide-react";
import { AGENT_ICONS } from "@/components/agent-icons";

interface PlanInputViewProps {
  description: string;
  onDescriptionChange: (value: string) => void;
  onStartPlanning: () => void;
  onStartBrainstorming: () => void;
  isStartingPlan: boolean;
  isStartingBrainstorm: boolean;
}

export function PlanInputView({
  description,
  onDescriptionChange,
  onStartPlanning,
  onStartBrainstorming,
  isStartingPlan,
  isStartingBrainstorm,
}: PlanInputViewProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Start Planning</h2>
        <p className="text-sm text-muted-foreground">
          Describe the feature you want to build. The Plan agent will
          explore the codebase, ask clarifying questions, and generate a
          phased implementation plan.
        </p>
      </div>
      <Textarea
        placeholder="Describe the feature you want to build..."
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        rows={6}
        className="resize-none"
      />
      <div className="flex gap-2">
        <Button
          onClick={onStartPlanning}
          disabled={
            !description.trim() || isStartingPlan || isStartingBrainstorm
          }
        >
          {isStartingPlan ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <AGENT_ICONS.plan className="mr-2 size-4" />
          )}
          Start Planning
        </Button>
        <Button
          variant="outline"
          onClick={onStartBrainstorming}
          disabled={
            !description.trim() || isStartingBrainstorm || isStartingPlan
          }
        >
          {isStartingBrainstorm ? (
            <Loader2Icon className="mr-2 size-4 animate-spin" />
          ) : (
            <AGENT_ICONS.brainstorm className="mr-2 size-4" />
          )}
          Start Brainstorming
        </Button>
      </div>
    </div>
  );
}
