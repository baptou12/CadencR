import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback, type ReactElement } from "react";
import { useGetFeature, type AgentMessageOrigin } from "@/api/generated";
import { navigateToFeatureIdOrHome } from "@/components/project-feature-navigation";

interface GeneratedBySessionBadgeProps {
  origin: AgentMessageOrigin;
}

export const GeneratedBySessionBadge = memo(function GeneratedBySessionBadge({
  origin,
}: GeneratedBySessionBadgeProps): ReactElement {
  const sourceFeatureId = origin.sourceFeatureId ?? 0;
  const featureQuery = useGetFeature(sourceFeatureId, {
    query: { enabled: Boolean(origin.sourceFeatureId) },
  });
  const projectId = featureQuery.data?.project_id ?? origin.sourceProjectId;
  const featureTitle = featureQuery.data?.title;
  const sessionLabel = origin.sourceSessionId
    ? `Session ${origin.sourceSessionId}`
    : "another session";
  const tooltipParts = [
    featureQuery.isError ? "Conversation title could not be loaded" : null,
    origin.sourceProjectId ? `Project ${origin.sourceProjectId}` : null,
    origin.sourceFeatureId ? `Feature ${origin.sourceFeatureId}` : null,
    origin.sourceMessageId ? `Message ${origin.sourceMessageId}` : null,
    origin.note,
  ].filter((part): part is string => Boolean(part));
  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-end gap-1.5 border-t border-primary/20 pt-1.5 font-mono text-[10.5px] text-muted-foreground"
      title={tooltipParts.join(" · ") || undefined}
    >
      <span className="rounded-full border border-primary/30 bg-background/50 px-1.5 py-0.5">
        Sent by
      </span>
      {featureQuery.isLoading ? (
        <span>Loading conversation…</span>
      ) : featureTitle &&
        typeof projectId === "number" &&
        typeof origin.sourceFeatureId === "number" ? (
        <SourceConversationButton
          featureId={origin.sourceFeatureId}
          featureTitle={featureTitle}
          projectId={projectId}
        />
      ) : (
        <span>{sessionLabel}</span>
      )}
    </div>
  );
});

function SourceConversationButton({
  featureId,
  featureTitle,
  projectId,
}: {
  featureId: number;
  featureTitle: string;
  projectId: number;
}): ReactElement {
  const navigate = useNavigate();
  const openConversation = useCallback((): void => {
    navigateToFeatureIdOrHome(navigate, projectId, featureId);
  }, [featureId, navigate, projectId]);

  return (
    <button
      type="button"
      onClick={openConversation}
      className="rounded-sm text-foreground/75 underline decoration-muted-foreground/40 underline-offset-2 transition-colors hover:text-[var(--acc-cyan)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      title="Open conversation"
      aria-label={`Open conversation ${featureTitle}`}
    >
      “{featureTitle}”
    </button>
  );
}
