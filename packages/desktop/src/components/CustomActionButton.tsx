import { memo, type ReactElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRunCustomAction, type CustomAction } from "@/api/generated";
import { invalidateCustomActionRunQueries } from "@/lib/custom-action-queries";
import { CustomActionIcon } from "./CustomActionIcon";
import { CustomActionStatusDot } from "./CustomActionStatusDot";

interface CustomActionButtonProps {
  action: CustomAction;
  featureId: number;
  projectId: number;
  /** Bar-level callback to open the shared details/output surface for this action. */
  onOpenDetails: (action: CustomAction) => void;
}

/**
 * Inline split button for a single custom action: the icon runs the action, the
 * chevron opens the shared details/output surface (owned by the bar). Run
 * status comes from the bar's single list query — kept live by a poll while a
 * run is in flight — so the dot stays accurate after the details popover
 * closes, without polling per button.
 *
 * Memoized because the bar re-renders on every poll tick while a run is active;
 * react-query's structural sharing keeps unchanged `action` objects stable, so
 * only the running action's button actually re-renders.
 */
function CustomActionButtonInner({
  action,
  featureId,
  projectId,
  onOpenDetails,
}: CustomActionButtonProps): ReactElement {
  const queryClient = useQueryClient();

  const runMutation = useRunCustomAction({
    mutation: {
      // The run is asynchronous: success just means it started. Refresh the
      // list so the status dot flips to "running"; the bar's poll keeps it
      // live and the eventual exit code (incl. failures) shows as a red dot
      // and in the details output, not a transient toast.
      onSuccess: () => {
        invalidateCustomActionRunQueries({
          queryClient,
          projectId,
          actionId: action.id,
          featureId,
        });
      },
      onError: (err) => toast.error(`${action.name} failed: ${err.message}`),
    },
  });

  return (
    <div className="inline-flex items-center">
      <Button
        variant="ghost"
        size="icon"
        className="relative size-7 rounded-r-none text-xs"
        title={`Run ${action.name}`}
        onClick={() => runMutation.mutate({ id: action.id, params: { feature_id: featureId } })}
        disabled={runMutation.isPending}
      >
        <CustomActionIcon
          iconData={action.icon_data ?? null}
          name={action.name}
          className="size-3.5"
        />
        <CustomActionStatusDot
          lastRun={action.last_run ?? null}
          isRunning={runMutation.isPending}
        />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-5 rounded-l-none px-0 text-xs"
        title={`Open ${action.name} details`}
        onClick={() => onOpenDetails(action)}
      >
        <ChevronDownIcon className="size-3" />
      </Button>
    </div>
  );
}

export const CustomActionButton = memo(CustomActionButtonInner);
