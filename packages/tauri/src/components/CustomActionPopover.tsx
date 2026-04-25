import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  getCustomActionRunsQueryKey,
  getCustomActionVariablesQueryKey,
  getListCustomActionsQueryKey,
  useDeleteCustomAction,
  useGetCustomActionRuns,
  useGetCustomActionVariables,
  useRunCustomAction,
  useSetCustomActionVariable,
  type CustomAction,
} from "@/api/generated";
import { CustomActionScheduleControl } from "./CustomActionScheduleControl";

interface CustomActionPopoverProps {
  action: CustomAction;
  featureId: number;
  projectId: number;
  /** Open the editor dialog in edit mode for this action. */
  onEdit: () => void;
  /** Close the popover after an action that should dismiss it (e.g. delete). */
  onAfterDelete: () => void;
}

export function CustomActionPopover({
  action,
  featureId,
  projectId,
  onEdit,
  onAfterDelete,
}: CustomActionPopoverProps) {
  const queryClient = useQueryClient();
  const { data: storedVars } = useGetCustomActionVariables(action.id, featureId);
  // Tight refetch so live runs (manual or scheduled) paint logs without a
  // manual refresh. `runs[0]` doubles as the source of "is a run in flight?".
  const runsQuery = useGetCustomActionRuns(action.id, featureId, 5, {
    refetchInterval: 2000,
  });
  const latestRun = runsQuery.data?.[0];
  const isRunning = latestRun != null && latestRun.ended_at == null;

  const runMutation = useRunCustomAction({
    onError: (err) => toast.error(`Run failed: ${err.message}`),
  });

  const setVariableMutation = useSetCustomActionVariable({
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: getCustomActionVariablesQueryKey(variables.actionId, variables.featureId),
      });
    },
    onError: (err) => toast.error(`Saving variable failed: ${err.message}`),
  });

  const deleteMutation = useDeleteCustomAction({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: getListCustomActionsQueryKey(projectId, featureId),
      });
      onAfterDelete();
      toast.success("Action deleted");
    },
    onError: (err) => toast.error(`Delete failed: ${err.message}`),
  });

  const valuesByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of storedVars ?? []) map.set(v.var_name, v.value);
    return map;
  }, [storedVars]);

  // Local draft state so typing doesn't fire a request on each keystroke;
  // we persist on blur.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, string> = { ...prev };
      for (const name of action.variable_names) {
        if (next[name] === undefined) {
          next[name] = valuesByName.get(name) ?? "";
        }
      }
      return next;
    });
  }, [action.variable_names, valuesByName]);

  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{action.name}</h3>
          <p className="text-xs text-muted-foreground truncate">
            <span className="font-mono">{action.command}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Edit action"
            onClick={onEdit}
          >
            <PencilIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive"
            title="Delete action"
            onClick={() => deleteMutation.mutate({ id: action.id })}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
          </Button>
        </div>
      </header>

      {action.variable_names.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
            Variables
          </h4>
          <div className="space-y-2">
            {action.variable_names.map((name) => (
              <label key={name} className="block space-y-1">
                <span className="block font-mono text-xs text-foreground">
                  ${"{"}
                  {name}
                  {"}"}
                </span>
                <Input
                  value={drafts[name] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [name]: e.target.value }))}
                  onBlur={() =>
                    setVariableMutation.mutate({
                      actionId: action.id,
                      featureId,
                      data: { var_name: name, value: drafts[name] ?? "" },
                    })
                  }
                  className="h-8 text-xs"
                />
              </label>
            ))}
          </div>
        </section>
      )}

      <section>
        <Button
          size="sm"
          onClick={() => runMutation.mutate({ actionId: action.id, featureId })}
          disabled={isRunning || runMutation.isPending}
          className="w-full"
        >
          {isRunning || runMutation.isPending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Running…
            </>
          ) : (
            <>
              <PlayIcon className="size-3.5" /> Run now
            </>
          )}
        </Button>
      </section>

      <section className="rounded border border-dashed p-2">
        <CustomActionScheduleControl actionId={action.id} featureId={featureId} />
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
          Recent runs
        </h4>
        {(runsQuery.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No runs yet.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto space-y-2 rounded border bg-muted/30 p-2">
            {(runsQuery.data ?? []).map((run) => (
              <div key={run.id} className="text-xs">
                <div className="flex items-center justify-between font-mono">
                  <span
                    className={cn(
                      "font-semibold",
                      run.exit_code === 0
                        ? "text-emerald-500"
                        : run.exit_code == null
                          ? "text-amber-500"
                          : "text-red-500",
                    )}
                  >
                    {run.exit_code == null
                      ? "running…"
                      : run.exit_code === 0
                        ? "exit 0"
                        : `exit ${run.exit_code}`}
                  </span>
                  <span className="text-muted-foreground">
                    {run.started_at} · {run.triggered_by}
                  </span>
                </div>
                {run.stdout && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
                    {run.stdout}
                  </pre>
                )}
                {run.stderr && (
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-red-500">
                    {run.stderr}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
