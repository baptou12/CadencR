import { useState } from "react";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { useWorkflowStore } from "@/hooks/useWorkflowWebSocket";
import { useNavigate } from "@tanstack/react-router";
import { TrashIcon, ArchiveIcon, BotIcon, MessageCircleQuestionIcon, ChevronRightIcon, ChevronDownIcon, PlugIcon } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFeatures, getListFeaturesQueryKey,
  useUpdateFeatureStatus, useDeleteFeature, useGetFeatureEmpty,
} from "@/api/generated";

const STATUSES = ["draft", "planned", "in-progress", "done", "archived"] as const;
type FeatureStatus = (typeof STATUSES)[number];

const STATUS_COLORS: Record<FeatureStatus, string> = {
  draft: "bg-gray-500/15 text-gray-300",
  planned: "bg-blue-500/15 text-blue-300",
  "in-progress": "bg-yellow-500/15 text-yellow-300",
  done: "bg-green-500/15 text-green-300",
  archived: "bg-gray-500/15 text-gray-400",
};

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
  featureTurnStates: Record<number, 'claude' | 'askUser'>;
  onSelectFeature: (featureId: number) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [confirmFeatureId, setConfirmFeatureId] = useState<number | null>(null);
  const { data: features = [] } = useListFeatures(projectId);

  // Live WS-pushed titles from auto-naming. Read raw store slices; derive per-feature inline.
  const wsSessions = useWsSessionStore((s) => s.sessions);
  const workflowFeatureId = useWorkflowStore((s) => s.featureId);
  const workflowTitle = useWorkflowStore((s) => s.featureTitle);

  /** Resolve the live WS title for a feature, or undefined to fall back to HTTP data. */
  const getLiveTitle = (id: number): string | undefined => {
    if (workflowFeatureId === id && workflowTitle) return workflowTitle;
    return wsSessions[wsSessionIdFromFeature(id)]?.featureTitle ?? undefined;
  };

  const activeFeatures = features.filter((f) => f.status !== "archived");
  const archivedFeatures = features.filter((f) => f.status === "archived");

  const invalidateFeatures = () => {
    void queryClient.invalidateQueries({ queryKey: getListFeaturesQueryKey(projectId) });
    void queryClient.invalidateQueries({ queryKey: ['features', 'detail'] });
    void queryClient.invalidateQueries({ queryKey: ['features', 'planProgress'] });
  };

  const updateStatusMutation = useUpdateFeatureStatus({
    onSuccess: invalidateFeatures,
  });

  const deleteMutation = useDeleteFeature({
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
  });

  const handleNavigate = (feature: (typeof features)[number]) => {
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
      window.dispatchEvent(new CustomEvent("cadence:focus-prompt"));
    });
  };

  const renderFeature = (feature: (typeof features)[number]) => {
    const turnState = featureTurnStates[feature.id];
    return (
      <div
        key={feature.id}
        role="button"
        tabIndex={0}
        data-nav-item
        data-nav-type="feature"
        data-nav-id={String(feature.id)}
        data-nav-project-id={String(projectId)}
        className={`group/feature relative flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden rounded-md py-1.5 pl-3 pr-2 text-sm outline-none hover:bg-accent ${
          activeFeatureId === feature.id ? "bg-accent" : ""
        } ${feature.status === "archived" ? "opacity-50" : ""}`}
        onClick={() => {
          handleNavigate(feature);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleNavigate(feature);
          }
        }}
      >
        {/* Turn state icon */}
        <div className="shrink-0 w-3.5">
          {turnState === 'claude' && (
            <BotIcon className="size-3.5 text-blue-500 animate-pulse" />
          )}
          {turnState === 'askUser' && (
            <MessageCircleQuestionIcon className="size-3.5 text-amber-400" />
          )}
        </div>

        {/* WS indicator */}
        {(feature.type === "ws-session" || feature.type === "ws-feature") && (
          <PlugIcon className="size-3 shrink-0 text-emerald-400" />
        )}

        {/* Feature name */}
        <span className={`min-w-0 truncate flex-1 ${feature.status === "archived" ? "text-muted-foreground" : ""}`}>
          {getLiveTitle(feature.id) ?? feature.title}
        </span>

        {/* Right-pinned actions */}
        <div className="absolute inset-y-0 right-0 flex items-center gap-1 rounded-r-md pr-1.5 pl-6 bg-gradient-to-l from-sidebar from-60% to-transparent group-hover/feature:from-accent group-[.bg-accent]/feature:from-accent">
          {feature.type !== "ws-session" && (
            <Select
              value={feature.status}
              onValueChange={(v) =>
                updateStatusMutation.mutate({
                  id: feature.id,
                  status: v as FeatureStatus,
                })
              }
            >
              <SelectTrigger
                size="sm"
                className="h-auto border-none bg-transparent p-0 shadow-none [&_svg[class*='opacity']]:hidden"
                onClick={(e) => e.stopPropagation()}
              >
                <Badge
                  variant="secondary"
                  className={`whitespace-nowrap ${STATUS_COLORS[feature.status as FeatureStatus] ?? ""}`}
                >
                  {feature.status}
                </Badge>
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover/feature:opacity-100 transition-none"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmFeatureId(feature.id);
            }}
          >
            {feature.status === "archived" ? (
              <TrashIcon className="size-3.5" />
            ) : (
              <ArchiveIcon className="size-3.5" />
            )}
            <span className="sr-only">{feature.status === "archived" ? "Delete" : "Archive"}</span>
          </Button>
        </div>
      </div>
    );
  };

  const confirmFeature = features.find((f) => f.id === confirmFeatureId);
  const isConfirmDelete = confirmFeature?.status === "archived";
  const isEmptyQuery = useGetFeatureEmpty(confirmFeatureId ?? 0, {
    enabled: confirmFeatureId != null && !isConfirmDelete,
  });
  const shouldDirectDelete = !isConfirmDelete && (isEmptyQuery.data?.empty ?? false);

  return (
    <div className="flex flex-col gap-0.5">
      {activeFeatures.map(renderFeature)}

      <ConfirmDialog
        open={confirmFeatureId != null && (isConfirmDelete || !isEmptyQuery.isLoading)}
        onOpenChange={(open) => { if (!open) setConfirmFeatureId(null); }}
        title={isConfirmDelete || shouldDirectDelete ? "Delete feature?" : "Archive feature?"}
        description={isConfirmDelete || shouldDirectDelete ? "This cannot be undone." : undefined}
        confirmText={isConfirmDelete || shouldDirectDelete ? "Delete" : "Archive"}
        variant={isConfirmDelete || shouldDirectDelete ? "destructive" : "default"}
        onConfirm={() => {
          if (confirmFeatureId == null) return;
          if (isConfirmDelete || shouldDirectDelete) {
            deleteMutation.mutate({ id: confirmFeatureId });
          } else {
            updateStatusMutation.mutate({ id: confirmFeatureId, status: "archived" as FeatureStatus });
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
