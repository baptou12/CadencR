import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, PencilIcon, PlayIcon, SquareIcon, TerminalIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getGetCustomActionVariablesQueryKey,
  getListCustomActionsQueryKey,
  useCancelCustomActionRun,
  useDeleteCustomAction,
  useGetCustomActionRuns,
  useGetCustomActionVariables,
  useSetCustomActionVariable,
  type CustomAction,
  type CustomActionRun,
} from "@/api/generated";
import { invalidateCustomActionRunQueries } from "@/lib/custom-action-queries";
import { useCustomActionRunner } from "@/hooks/useCustomActionRunner";
import { BashBlock } from "./BashBlock";
import { CustomActionScheduleControl } from "./CustomActionScheduleControl";

/**
 * Merge a run's captured streams into a single terminal-style body. We capture
 * stdout/stderr separately but the shared bash block renders one stream (as a
 * terminal would); stderr is appended after stdout.
 */
function runOutput(run: CustomActionRun): string {
  return [run.stdout, run.stderr].filter(Boolean).join("\n");
}

interface CustomActionDetailsProps {
  action: CustomAction;
  featureId: number;
  projectId: number;
  /** Open the editor dialog in edit mode for this action. */
  onEdit: () => void;
  /** Close the surrounding surface after an action that should dismiss it (e.g. delete). */
  onAfterDelete: () => void;
}

/**
 * Unified run/output/details surface for a custom action, shown identically for
 * inline and overflow actions. Polls the action's recent runs so live output
 * (manual or scheduled) streams in without a manual refresh, and exposes the
 * run button, per-feature variables and the schedule control.
 */
export function CustomActionDetails({
  action,
  featureId,
  projectId,
  onEdit,
  onAfterDelete,
}: CustomActionDetailsProps) {
  const queryClient = useQueryClient();
  const { data: storedVars } = useGetCustomActionVariables(action.id, { feature_id: featureId });
  // Poll only while the latest run is in flight, so live logs paint without a
  // manual refresh but a finished run stops generating no-op requests. `runs[0]`
  // doubles as the source of "is a run in flight?".
  const runsQuery = useGetCustomActionRuns(
    action.id,
    { feature_id: featureId, limit: 5 },
    {
      query: {
        refetchInterval: (data) => (data?.[0] != null && data[0].ended_at == null ? 2000 : false),
      },
    },
  );
  const latestRun = runsQuery.data?.[0];
  const isRunning = latestRun != null && latestRun.ended_at == null;

  // Which run we've asked to stop. The cancel request returns immediately but
  // the process takes a moment to die (Ctrl-C, then SIGKILL), so we keep the
  // loader until the run actually finalizes rather than only during the POST.
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const { run, isStarting } = useCustomActionRunner({ action, featureId, projectId });

  const cancelMutation = useCancelCustomActionRun({
    mutation: {
      // The backend interrupts the process (Ctrl-C) and finalizes the run;
      // refresh so the stopped state shows without waiting for the 2s poll.
      onSuccess: () => {
        invalidateCustomActionRunQueries({
          queryClient,
          projectId,
          actionId: action.id,
          featureId,
        });
      },
      // Re-enable the button so the user can retry if the request itself fails.
      onError: (err) => {
        setCancellingId(null);
        toast.error(`Stop failed: ${err.message}`);
      },
    },
  });

  // Show the stopping loader from the click until the run leaves the running
  // state. Gating on the run id means a stale `cancellingId` self-clears once
  // that run finalizes (isRunning false) or a new run takes its place.
  const isStopping = isRunning && latestRun != null && cancellingId === latestRun.id;

  const setVariableMutation = useSetCustomActionVariable({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: getGetCustomActionVariablesQueryKey(variables.id, variables.params),
        });
      },
      onError: (err) => toast.error(`Saving variable failed: ${err.message}`),
    },
  });

  const deleteMutation = useDeleteCustomAction({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getListCustomActionsQueryKey({ project_id: projectId, feature_id: featureId }),
        });
        onAfterDelete();
        toast.success("Action deleted");
      },
      onError: (err) => toast.error(`Delete failed: ${err.message}`),
    },
  });

  const valuesByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of storedVars ?? []) map.set(v.var_name, v.value);
    return map;
  }, [storedVars]);

  // Pre-merge each run's streams once per data change. react-query keeps
  // unchanged runs referentially stable, so a finished run's `output` string
  // stays identical across poll ticks and its memoized BashBlock won't re-render.
  const runViews = useMemo(
    () => (runsQuery.data ?? []).map((run) => ({ run, output: runOutput(run) })),
    [runsQuery.data],
  );

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
                      id: action.id,
                      params: { feature_id: featureId },
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
        {action.run_in_terminal ? (
          // Terminal actions are owned by the terminal split (its own
          // kill/restart controls), so there's no background run to stop here.
          <Button size="sm" onClick={run} disabled={isStarting} className="w-full">
            {isStarting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <TerminalIcon className="size-3.5" /> Run in terminal
              </>
            )}
          </Button>
        ) : isRunning && latestRun ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setCancellingId(latestRun.id);
              cancelMutation.mutate({ id: action.id, runId: latestRun.id });
            }}
            disabled={isStopping}
            className="w-full"
            title="Stop the running command (Ctrl-C)"
          >
            {isStopping ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Stopping…
              </>
            ) : (
              <>
                <SquareIcon className="size-3.5 fill-current" /> Stop
              </>
            )}
          </Button>
        ) : (
          <Button size="sm" onClick={run} disabled={isStarting} className="w-full">
            {isStarting ? (
              <>
                <Loader2 className="size-3.5 animate-spin" /> Starting…
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" /> Run now
              </>
            )}
          </Button>
        )}
      </section>

      <section className="rounded border border-dashed p-2">
        <CustomActionScheduleControl actionId={action.id} featureId={featureId} />
      </section>

      <section className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
          Recent runs
        </h4>
        {runViews.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No runs yet.</p>
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {runViews.map(({ run, output }) => (
              <div key={run.id} className="space-y-1 text-xs">
                {/* Exit status is conveyed by the bash block colour (red on
                    failure) rather than a redundant "exit N" label. */}
                <div className="font-mono text-[11px] text-muted-foreground">
                  {run.started_at} · {run.triggered_by}
                </div>
                <BashBlock
                  command={action.command}
                  content={output}
                  running={run.ended_at == null}
                  isError={run.exit_code != null && run.exit_code !== 0}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
