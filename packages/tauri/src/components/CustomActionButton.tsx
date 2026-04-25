import { useState, type MouseEvent } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  getCustomActionRunsQueryKey,
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

/**
 * Inline action button.
 *
 * - Left click: runs the command.
 * - Right click (context menu): opens the detailed popover (variables,
 *   schedule, recent run logs, edit/delete).
 *
 * Status dot is read straight from `action.last_run`, which the bar's
 * single `useListCustomActions` query embeds — no per-button polling.
 */
export function CustomActionButton({
  action,
  featureId,
  projectId,
  onEdit,
}: CustomActionButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const runMutation = useRunCustomAction({
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: getListCustomActionsQueryKey(projectId, featureId),
      });
      queryClient.invalidateQueries({
        queryKey: getCustomActionRunsQueryKey(action.id, featureId),
      });
      if (data.exit_code !== 0) {
        const detail = data.stderr.trim() || `exit ${data.exit_code ?? "?"}`;
        toast.error(`${action.name} failed: ${detail.slice(0, 200)}`);
      }
    },
    onError: (err) => toast.error(`${action.name} failed: ${err.message}`),
  });

  function handleClick(): void {
    runMutation.mutate({ actionId: action.id, featureId });
  }

  function handleContextMenu(e: MouseEvent<HTMLButtonElement>): void {
    e.preventDefault();
    setOpen(true);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-7"
          title={`${action.name} — left click runs, right click opens details`}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          disabled={runMutation.isPending}
        >
          <CustomActionIcon iconData={action.icon_data} name={action.name} />
          <CustomActionStatusDot lastRun={action.last_run} isRunning={runMutation.isPending} />
        </Button>
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
