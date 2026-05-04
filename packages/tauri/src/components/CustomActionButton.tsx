import { useState, type ReactElement } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  getGetCustomActionRunsQueryKey,
  getListCustomActionsQueryKey,
  useRunCustomAction,
  type CustomAction,
} from "@/api/generated";
import { CustomActionIcon } from "./CustomActionIcon";
import { CustomActionPopover } from "./CustomActionPopover";
import { CustomActionStatusDot } from "./CustomActionStatusDot";

interface CustomActionButtonProps {
  action: CustomAction;
  featureId: number;
  projectId: number;
  /** Bar-level callback to open the editor dialog in edit mode for this action. */
  onEdit: (action: CustomAction) => void;
}

/** Status comes from the bar's single list query, so buttons don't poll per action. */
export function CustomActionButton({
  action,
  featureId,
  projectId,
  onEdit,
}: CustomActionButtonProps): ReactElement {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const runMutation = useRunCustomAction({
    mutation: {
      onSuccess: (data, vars) => {
        queryClient.invalidateQueries({
          queryKey: getListCustomActionsQueryKey({ project_id: projectId, ...vars.params }),
        });
        queryClient.invalidateQueries({
          queryKey: getGetCustomActionRunsQueryKey(vars.id, vars.params),
        });
        if (data.exit_code !== 0) {
          const detail = data.stderr.trim() || `exit ${data.exit_code ?? "?"}`;
          toast.error(`${action.name} failed: ${detail.slice(0, 200)}`);
        }
      },
      onError: (err) => toast.error(`${action.name} failed: ${err.message}`),
    },
  });

  function handleClick(): void {
    runMutation.mutate({ id: action.id, params: { feature_id: featureId } });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="inline-flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="relative size-7 rounded-r-none text-xs"
            title={`Run ${action.name}`}
            onClick={handleClick}
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
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-5 rounded-l-none px-0 text-xs"
              title={`Open ${action.name} details`}
            >
              <ChevronDownIcon className="size-3" />
            </Button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-[28rem]">
        <CustomActionPopover
          action={action}
          featureId={featureId}
          projectId={projectId}
          onEdit={() => {
            setOpen(false);
            onEdit(action);
          }}
          onAfterDelete={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
