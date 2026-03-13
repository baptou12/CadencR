import { Button } from "@/components/ui/button";
import {
  Loader2Icon,
  PlusCircleIcon,
  WrenchIcon,
} from "lucide-react";

interface ReviewVerdictActionsProps {
  show: boolean;
  reviewVerdict: "changes_requested" | null;
  onAddFixPhase: () => void;
  onFixImmediately: () => void;
  isAddingFixPhase: boolean;
  isStartingFix: boolean;
}

export function ReviewVerdictActions({
  show,
  reviewVerdict,
  onAddFixPhase,
  onFixImmediately,
  isAddingFixPhase,
  isStartingFix,
}: ReviewVerdictActionsProps) {
  if (!show || reviewVerdict !== "changes_requested") return null;

  return (
    <div className="mt-2 flex gap-2 px-3">
      <Button
        variant="outline"
        size="sm"
        onClick={onAddFixPhase}
        disabled={isAddingFixPhase}
      >
        {isAddingFixPhase ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <PlusCircleIcon className="mr-2 size-4" />
        )}
        Add Fix Phase
      </Button>
      <Button
        size="sm"
        onClick={onFixImmediately}
        disabled={isStartingFix}
      >
        {isStartingFix ? (
          <Loader2Icon className="mr-2 size-4 animate-spin" />
        ) : (
          <WrenchIcon className="mr-2 size-4" />
        )}
        Fix Immediately
      </Button>
    </div>
  );
}
