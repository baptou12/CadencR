import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getGetCustomActionRunsQueryKey,
  getListCustomActionsQueryKey,
  useDeleteCustomAction,
  useRunCustomAction,
  type CustomAction,
} from "@/api/generated";
import { CustomActionIcon } from "./CustomActionIcon";

interface CustomActionsOverflowDropdownProps {
  actions: CustomAction[];
  featureId: number;
  projectId: number;
  onEdit: (action: CustomAction) => void;
}

/**
 * Dropdown showing every action that doesn't fit inline (positions 3..N).
 * Clicking an entry runs the action; the chevron submenu offers Edit/Delete.
 */
export function CustomActionsOverflowDropdown({
  actions,
  featureId,
  projectId,
  onEdit,
}: CustomActionsOverflowDropdownProps) {
  const queryClient = useQueryClient();

  const runMutation = useRunCustomAction({
    mutation: {
      onSuccess: (_data, vars) => {
        queryClient.invalidateQueries({
          queryKey: getListCustomActionsQueryKey({ project_id: projectId, ...vars.params }),
        });
        queryClient.invalidateQueries({
          queryKey: getGetCustomActionRunsQueryKey(vars.id, vars.params),
        });
      },
      onError: (err) => toast.error(`Run failed: ${err.message}`),
    },
  });

  const deleteMutation = useDeleteCustomAction({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCustomActionsQueryKey({ project_id: projectId, feature_id: featureId }),
        });
        toast.success("Action deleted");
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    },
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 text-xs" title="More actions">
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {actions.map((action) => (
          <DropdownMenuSub key={action.id}>
            <DropdownMenuSubTrigger>
              <CustomActionIcon iconData={action.icon_data ?? null} name={action.name} />
              <span className="truncate">{action.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onSelect={() =>
                  runMutation.mutate({ id: action.id, params: { feature_id: featureId } })
                }
              >
                <PlayIcon className="size-4" /> Run now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onEdit(action)}>
                <PencilIcon className="size-4" /> Edit / variables / schedule
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => deleteMutation.mutate({ id: action.id })}
              >
                <Trash2Icon className="size-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
