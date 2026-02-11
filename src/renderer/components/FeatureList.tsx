import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { trpc } from "@/trpc";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlusIcon, TrashIcon } from "lucide-react";

const STATUSES = ["draft", "planned", "in-progress", "review", "done"] as const;
type FeatureStatus = (typeof STATUSES)[number];

const STATUS_COLORS: Record<FeatureStatus, string> = {
  draft: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
  planned: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "in-progress": "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  review: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  done: "bg-green-500/15 text-green-700 dark:text-green-300",
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const utils = trpc.useUtils();

  const queryInput =
    statusFilter === "all"
      ? { project_id: projectId }
      : { project_id: projectId, status: statusFilter };

  const { data: features = [] } = trpc.features.listByProject.useQuery(queryInput);

  const createMutation = trpc.features.create.useMutation({
    onSuccess: () => {
      void utils.features.listByProject.invalidate();
      setDialogOpen(false);
      setNewTitle("");
    },
  });

  const updateStatusMutation = trpc.features.updateStatus.useMutation({
    onSuccess: () => {
      void utils.features.listByProject.invalidate();
    },
  });

  const deleteMutation = trpc.features.delete.useMutation({
    onSuccess: () => {
      void utils.features.listByProject.invalidate();
    },
  });

  const handleCreate = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    createMutation.mutate({ project_id: projectId, title: trimmed });
  };

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

        <Button size="sm" variant="ghost" onClick={() => setDialogOpen(true)}>
          <PlusIcon className="size-4" />
          <span className="sr-only">Add feature</span>
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 px-2 pb-2">
          {features.map((feature) => (
            <div
              key={feature.id}
              role="button"
              tabIndex={0}
              className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent ${
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
              <span className="flex-1 truncate">{feature.title}</span>

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
                  className="h-auto border-none bg-transparent p-0 shadow-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Badge
                    variant="secondary"
                    className={STATUS_COLORS[feature.status as FeatureStatus] ?? ""}
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

              <Button
                size="sm"
                variant="ghost"
                className="size-6 p-0 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteMutation.mutate({ id: feature.id });
                }}
              >
                <TrashIcon className="size-3.5" />
                <span className="sr-only">Delete</span>
              </Button>
            </div>
          ))}

          {features.length === 0 && (
            <p className="text-muted-foreground px-2 py-4 text-center text-sm">
              No features yet
            </p>
          )}
        </div>
      </ScrollArea>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Feature</DialogTitle>
            <DialogDescription>Enter a title for the new feature.</DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Feature title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
          />
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!newTitle.trim() || createMutation.isLoading}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
