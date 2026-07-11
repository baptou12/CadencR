import { ShieldAlertIcon } from "lucide-react";
import { memo, useCallback, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useGetFeature } from "@/api/generated";
import { navigateToFeatureIdOrHome } from "@/components/project-feature-navigation";
import type { SessionGateEnvelope } from "@/lib/session-gate";

interface SessionGateBlockProps {
  gate: SessionGateEnvelope;
}

interface GatePresentationProps extends SessionGateBlockProps {
  title: string;
  projectId?: number;
  lookupError?: boolean;
}

export const SessionGateBlock = memo(function SessionGateBlock({
  gate,
}: SessionGateBlockProps): ReactElement {
  if (gate.childFeatureTitle && gate.childProjectId !== undefined) {
    return (
      <GatePresentation
        gate={gate}
        title={gate.childFeatureTitle}
        projectId={gate.childProjectId}
      />
    );
  }
  return <SessionGateLookup gate={gate} />;
});

const SessionGateLookup = memo(function SessionGateLookup({
  gate,
}: SessionGateBlockProps): ReactElement {
  const featureQuery = useGetFeature(gate.childFeatureId);
  const title =
    featureQuery.data?.title ??
    gate.childFeatureTitle ??
    (featureQuery.isLoading ? "Loading conversation…" : `Session ${gate.childSessionId}`);
  return (
    <GatePresentation
      gate={gate}
      title={title}
      projectId={featureQuery.data?.project_id ?? gate.childProjectId}
      lookupError={featureQuery.isError}
    />
  );
});

const GatePresentation = memo(function GatePresentation({
  gate,
  title,
  projectId,
  lookupError = false,
}: GatePresentationProps): ReactElement {
  const navigate = useNavigate();
  const openChild = useCallback((): void => {
    if (projectId !== undefined)
      navigateToFeatureIdOrHome(navigate, projectId, gate.childFeatureId);
  }, [gate.childFeatureId, navigate, projectId]);
  const policy =
    gate.autonomy === "human_only"
      ? "Human action required"
      : gate.autonomy === "parent_answers_all"
        ? "Parent answers all eligible gates"
        : "Parent may answer eligible gates";

  return (
    <div className="mx-auto my-2 flex w-full max-w-[85%] flex-col gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <ShieldAlertIcon className="size-3.5" aria-hidden="true" />
        <span className="font-medium">Child {gate.kind} gate</span>
        <button
          type="button"
          onClick={openChild}
          disabled={projectId === undefined}
          className="underline underline-offset-2 disabled:no-underline"
          title={lookupError ? "Child conversation could not be loaded" : "Open child conversation"}
        >
          “{lookupError ? `${title} (title unavailable)` : title}”
        </button>
        <span className="text-muted-foreground">{policy}</span>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background/60 p-2 text-[11px] text-muted-foreground">
        {JSON.stringify(gate.payload, null, 2)}
      </pre>
    </div>
  );
});
