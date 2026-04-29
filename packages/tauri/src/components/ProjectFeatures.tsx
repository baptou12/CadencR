import { useMemo, useState } from "react";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFeatures,
  useUpdateFeatureStatus,
  useDeleteFeature,
  useIsFeatureEmpty,
  useListFeatureWorktrees,
  type Feature,
} from "@/api/generated";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { ProjectFeatureRow, type FeatureStatus } from "@/components/ProjectFeatureRow";

export function ProjectFeatures({
  projectId,
  projectPath,
  activeFeatureId,
  featureTurnStates,
  onSelectFeature,
}: {
  projectId: number;
  projectPath: string;
  activeFeatureId: number | null;
  featureTurnStates: Record<number, { turn: "agent" | "askUser"; kind: string | null }>;
  onSelectFeature: (featureId: number) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [confirmFeatureId, setConfirmFeatureId] = useState<number | null>(null);
  const { data: features = [] } = useListFeatures({ project_id: projectId });
  const { data: featureWorktrees = [] } = useListFeatureWorktrees(
    { project_id: projectId },
    { query: { staleTime: 5 * 60 * 1000 } },
  );

  const { worktreeFeatureIds, liveWorktreeFeatureIds } = useMemo(() => {
    const all = new Set<number>();
    const live = new Set<number>();
    for (const w of featureWorktrees) {
      all.add(w.feature_id);
      if (w.live) live.add(w.feature_id);
    }
    return { worktreeFeatureIds: all, liveWorktreeFeatureIds: live };
  }, [featureWorktrees]);

  // Live WS-pushed titles from auto-naming. Read raw store slices; derive per-feature inline.
  const wsSessions = useWsSessionStore((s) => s.sessions);
  const workflowFeatureId = useWorkflowStore((s) => s.featureId);
  const workflowTitle = useWorkflowStore((s) => s.featureTitle);
  const workflowAutoNaming = useWorkflowStore((s) => s.isAutoNaming);

  /** Resolve the live WS title for a feature, or undefined to fall back to HTTP data. */
  const getLiveTitle = (id: number): string | undefined => {
    if (workflowFeatureId === id && workflowTitle) return workflowTitle;
    return wsSessions[wsSessionIdFromFeature(id)]?.featureTitle ?? undefined;
  };

  /** True while auto-naming is running for the given feature. */
  const isAutoNaming = (id: number): boolean => {
    if (workflowFeatureId === id && workflowAutoNaming) return true;
    return wsSessions[wsSessionIdFromFeature(id)]?.isAutoNaming ?? false;
  };

  const activeFeatures = features.filter((f) => f.status !== "archived");
  const archivedFeatures = features.filter((f) => f.status === "archived");

  const invalidateFeatures = () => {
    // Catch every feature-scoped cache: list, detail, plan, plan/progress, etc.
    void invalidateByUrlPrefix(queryClient, "/api/features");
  };

  const updateStatusMutation = useUpdateFeatureStatus({
    mutation: {
      onSuccess: invalidateFeatures,
    },
  });

  const deleteMutation = useDeleteFeature({
    mutation: {
      onSuccess: (_data, variables) => {
        const deletedId = variables.id;
        if (deletedId === activeFeatureId) {
          const idx = features.findIndex((f) => f.id === deletedId);
          const next = features[idx + 1] ?? features[idx - 1];
          if (next) {
            void navigate({
              to: "/projects/$projectId/features/$featureId",
              params: {
                projectId: String(projectId),
                featureId: String(next.id),
              },
            });
          } else {
            void navigate({ to: "/" });
          }
        }
        invalidateFeatures();
      },
    },
  });

  const handleNavigate = (feature: Feature) => {
    onSelectFeature(feature.id);
    if (feature.type === "ws-session") {
      const wsSessionId = wsSessionIdFromFeature(feature.id);
      void navigate({
        to: "/ws-session/$sessionId",
        params: { sessionId: wsSessionId },
        search: { cwd: projectPath, featureId: feature.id, projectId },
      });
    } else {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(projectId),
          featureId: String(feature.id),
        },
      });
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent("cadencr:focus-prompt"));
    });
  };

  const handleStatusChange = (featureId: number, status: FeatureStatus) => {
    updateStatusMutation.mutate({ id: featureId, data: { status } });
  };

  const renderFeature = (feature: Feature) => (
    <ProjectFeatureRow
      key={feature.id}
      feature={feature}
      projectId={projectId}
      activeFeatureId={activeFeatureId}
      turn={featureTurnStates[feature.id]?.turn}
      liveTitle={getLiveTitle(feature.id)}
      isAutoNaming={isAutoNaming(feature.id)}
      hasWorktree={worktreeFeatureIds.has(feature.id)}
      hasLiveWorktree={liveWorktreeFeatureIds.has(feature.id)}
      onNavigate={handleNavigate}
      onStatusChange={handleStatusChange}
      onArchiveOrDelete={setConfirmFeatureId}
    />
  );

  const confirmFeature = features.find((f) => f.id === confirmFeatureId);
  const isConfirmDelete = confirmFeature?.status === "archived";
  const isEmptyQuery = useIsFeatureEmpty(confirmFeatureId ?? 0, {
    query: { enabled: confirmFeatureId != null && !isConfirmDelete },
  });
  const shouldDirectDelete = !isConfirmDelete && (isEmptyQuery.data?.empty ?? false);

  return (
    <div className="flex flex-col gap-0.5">
      {activeFeatures.map(renderFeature)}

      <ConfirmDialog
        open={confirmFeatureId != null && (isConfirmDelete || !isEmptyQuery.isLoading)}
        onOpenChange={(open) => {
          if (!open) setConfirmFeatureId(null);
        }}
        title={isConfirmDelete || shouldDirectDelete ? "Delete feature?" : "Archive feature?"}
        description={isConfirmDelete || shouldDirectDelete ? "This cannot be undone." : undefined}
        confirmText={isConfirmDelete || shouldDirectDelete ? "Delete" : "Archive"}
        variant={isConfirmDelete || shouldDirectDelete ? "destructive" : "default"}
        onConfirm={() => {
          if (confirmFeatureId == null) return;
          if (isConfirmDelete || shouldDirectDelete) {
            deleteMutation.mutate({ id: confirmFeatureId });
          } else {
            updateStatusMutation.mutate({
              id: confirmFeatureId,
              data: { status: "archived" },
            });
          }
        }}
      />

      {archivedFeatures.length > 0 && (
        <>
          <button
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowArchived((v) => !v)}
          >
            <span className="flex-1 border-t border-border/50" />
            {showArchived ? (
              <ChevronDownIcon className="size-3 shrink-0" />
            ) : (
              <ChevronRightIcon className="size-3 shrink-0" />
            )}
            <span className="shrink-0">Archived ({archivedFeatures.length})</span>
            <span className="flex-1 border-t border-border/50" />
          </button>
          {showArchived && (
            <div className="max-h-[calc(5*2.25rem)] overflow-y-auto">
              {archivedFeatures.map(renderFeature)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
