import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/trpc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlusIcon, TrashIcon, Loader2Icon } from "lucide-react";

const STATUSES = ["draft", "planned", "in-progress", "review", "done"] as const;
type FeatureStatus = (typeof STATUSES)[number];

const STATUS_COLORS: Record<FeatureStatus, string> = {
  draft: "bg-gray-500/15 text-gray-300",
  planned: "bg-blue-500/15 text-blue-300",
  "in-progress": "bg-yellow-500/15 text-yellow-300",
  review: "bg-purple-500/15 text-purple-300",
  done: "bg-green-500/15 text-green-300",
};

interface FeatureListProps {
  projectId: number;
  selectedFeatureId?: number;
  onSelectFeature?: (featureId: number) => void;
}

export function FeatureList({
  projectId,
  selectedFeatureId,
  onSelectFeature,
}: FeatureListProps) {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<FeatureStatus | "all">("all");

  const utils = trpc.useUtils();

  const queryInput =
    statusFilter === "all"
      ? { project_id: projectId }
      : { project_id: projectId, status: statusFilter };

  const { data: features = [] } = trpc.features.listByProject.useQuery(queryInput);

  // Poll for features with running agents
  const { data: activeFeatureIds = [] } = trpc.agents.getActiveFeatureIds.useQuery(
    undefined,
    { refetchInterval: 3000 },
  );

  const invalidateFeatures = () => {
    void utils.features.listByProject.invalidate();
    void utils.features.getById.invalidate();
    void utils.features.getProgress.invalidate();
  };

  const createMutation = trpc.features.create.useMutation({
    onSuccess: (feature) => {
      invalidateFeatures();
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(projectId),
          featureId: String(feature.id),
        },
      });
    },
  });

  const createSessionMutation = trpc.features.createSession.useMutation({
    onSuccess: (session) => {
      invalidateFeatures();
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(projectId),
          featureId: String(session.id),
        },
      });
    },
  });

  const updateStatusMutation = trpc.features.updateStatus.useMutation({
    onSuccess: invalidateFeatures,
  });

  const deleteMutation = trpc.features.delete.useMutation({
    onSuccess: (_data, variables) => {
      const deletedId = variables.id;

      // If the deleted feature/session was currently viewed, navigate away
      if (deletedId === selectedFeatureId) {
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

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-2">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as FeatureStatus | "all")}
        >
          <SelectTrigger size="sm" className="w-28">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              <PlusIcon className="size-4" />
              <span className="sr-only">Add</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => createMutation.mutate({ project_id: projectId })}>
              New Feature
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => createSessionMutation.mutate({ project_id: projectId })}>
              New Session
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 px-2 pb-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              role="button"
              tabIndex={0}
              data-nav-item
              data-nav-type="feature"
              data-nav-id={String(feature.id)}
              data-nav-project-id={String(projectId)}
              className={`group relative flex min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:bg-blue-500/10 ${
                selectedFeatureId === feature.id ? "bg-accent" : ""
              }`}
              onClick={() => {
                onSelectFeature?.(feature.id);
                void navigate({
                  to: "/projects/$projectId/features/$featureId",
                  params: {
                    projectId: String(projectId),
                    featureId: String(feature.id),
                  },
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectFeature?.(feature.id);
                  void navigate({
                    to: "/projects/$projectId/features/$featureId",
                    params: {
                      projectId: String(projectId),
                      featureId: String(feature.id),
                    },
                  });
                }
              }}
            >
              {activeFeatureIds.includes(feature.id) && (
                <Loader2Icon className="size-3.5 shrink-0 animate-spin text-blue-500" />
              )}
              <span className="truncate pr-1">{feature.title}</span>

              <div className="absolute inset-y-0 right-0 flex items-center gap-1 rounded-r-md pr-1.5 pl-6 bg-gradient-to-l from-sidebar from-60% to-transparent group-hover:from-accent group-[.bg-accent]:from-accent">
                {feature.type !== "session" && (
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
                  className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate({ id: feature.id });
                  }}
                >
                  <TrashIcon className="size-3.5" />
                  <span className="sr-only">Delete</span>
                </Button>
              </div>
            </div>
          ))}

          {features.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">
              No features yet
            </p>
          )}
        </div>
      </ScrollArea>

    </div>
  );
}
