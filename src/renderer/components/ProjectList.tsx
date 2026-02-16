import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Ellipsis, Plus } from "lucide-react";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ModelSelector } from "./ModelSelector";

interface ProjectListProps {
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

function ProjectSettingsDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: number;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.projects.getSettings.useQuery(
    { project_id: projectId },
    { enabled: open },
  );
  const setSettingMutation = trpc.projects.setSetting.useMutation({
    onSuccess: () => {
      void utils.projects.getSettings.invalidate({ project_id: projectId });
    },
  });

  const branchPrefix = settings?.branch_prefix ?? "";
  const agentAutonomy = settings?.agent_autonomy ?? "1";
  const [setupWorktree, setSetupWorktree] = useState(settings?.setup_worktree ?? "");
  useEffect(() => {
    if (settings?.setup_worktree != null) {
      setSetupWorktree(settings.setup_worktree);
    }
  }, [settings?.setup_worktree]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Project Settings: {projectName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold">Model Configuration</h4>
              <p className="text-xs text-muted-foreground">
                Override models for this project
              </p>
            </div>
            <ModelSelector level="project" projectId={projectId} />
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Git &amp; Automation</h4>

            <div className="space-y-1">
              <span className="text-xs font-medium">Branch Prefix</span>
              <Input
                placeholder="e.g. feature/"
                value={branchPrefix}
                onChange={(e) =>
                  setSettingMutation.mutate({
                    project_id: projectId,
                    key: "branch_prefix",
                    value: e.target.value,
                  })
                }
                className="h-8 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Prefix added to worktree branch names
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium">Worktree Setup Commands</span>
              <Textarea
                placeholder={"e.g. pnpm install\ncp .env.example .env"}
                rows={3}
                value={setupWorktree}
                onChange={(e) => setSetupWorktree(e.target.value)}
                onBlur={() =>
                  setSettingMutation.mutate({
                    project_id: projectId,
                    key: "setup_worktree",
                    value: setupWorktree,
                  })
                }
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Shell commands to run after creating a worktree (one per line)
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs font-medium">Agent Autonomy</span>
              <Select
                value={agentAutonomy}
                onValueChange={(value) =>
                  setSettingMutation.mutate({
                    project_id: projectId,
                    key: "agent_autonomy",
                    value,
                  })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Low — ask before commit</SelectItem>
                  <SelectItem value="2">Medium — manual continue</SelectItem>
                  <SelectItem value="3">High — full auto</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls how much the execute agent does automatically
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProjectList({
  selectedProjectId,
  onSelectProject,
}: ProjectListProps) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [settingsProject, setSettingsProject] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const projectsQuery = trpc.projects.list.useQuery();
  const selectFolderMutation = trpc.projects.selectFolder.useMutation();
  const createMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      void utils.projects.list.invalidate();
    },
  });
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      void utils.projects.list.invalidate();
    },
  });
  const projects = projectsQuery.data ?? [];

  const handleAdd = async () => {
    const folder = await selectFolderMutation.mutateAsync();
    if (!folder) return;
    createMutation.mutate({ name: folder.name, path: folder.path });
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    deleteMutation.mutate({ id });
  };

  const handleProjectClick = async (projectId: number) => {
    // Update sidebar state
    onSelectProject(projectId);

    // Query for features in this project
    const features = await utils.features.listByProject.fetch({
      project_id: projectId,
    });

    // Navigate to first feature if available, otherwise go to home
    if (features && features.length > 0) {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(projectId),
          featureId: String(features[0].id),
        },
      });
    } else {
      // Navigate to home when project has no features
      void navigate({ to: "/" });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleAdd}
          disabled={selectFolderMutation.isLoading || createMutation.isLoading}
        >
          <Plus />
        </Button>
      </div>
      <ScrollArea className="max-h-40">
        <div className="flex flex-col gap-0.5">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              data-nav-item
              data-nav-type="project"
              data-nav-id={String(project.id)}
              onClick={() => void handleProjectClick(project.id)}
              className={`group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:bg-blue-500/10 ${
                selectedProjectId === project.id
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
            >
              <span className="truncate">{project.name}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <span
                    role="button"
                    tabIndex={0}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Ellipsis className="h-3.5 w-3.5" />
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      setSettingsProject({ id: project.id, name: project.name });
                    }}
                  >
                    Project Settings
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => handleDelete(e, project.id)}
                  >
                    Delete Project
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </button>
          ))}
          {projects.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              No projects yet
            </p>
          )}
        </div>
      </ScrollArea>

      {settingsProject && (
        <ProjectSettingsDialog
          projectId={settingsProject.id}
          projectName={settingsProject.name}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSettingsProject(null);
          }}
        />
      )}
    </div>
  );
}
