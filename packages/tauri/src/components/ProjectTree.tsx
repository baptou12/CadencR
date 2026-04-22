import { useState, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, ChevronDown, Ellipsis, Plus, PlusIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  useCreateProject,
  useDeleteProject,
  getListProjectsQueryKey,
  useCreateFeature,
  useSetProjectSetting,
  getListFeaturesQueryKey,
} from "../api/generated";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { wsSessionIdFromFeature } from "@/lib/ws-session-id";
import { ProjectColorDot } from "@/hooks/useProjectColor";
import { PROJECT_COLORS } from "@/lib/project-colors";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import { ProjectFeatures } from "./ProjectFeatures";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAppWsStore } from "@/stores/app-ws-store";
import { open } from "@tauri-apps/plugin-dialog";

interface ProjectTreeProps {
  activeProjectId: number | null;
  activeFeatureId: number | null;
  onSelectFeature: (featureId: number) => void;
}

export function ProjectTree({
  activeProjectId,
  activeFeatureId,
  onSelectFeature,
}: ProjectTreeProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectsQuery = useListProjects();
  const projects = projectsQuery.data ?? [];

  const featureTurnStates = useAppWsStore((s) => s.featureTurnStates);

  const [isSelectingFolder, setIsSelectingFolder] = useState(false);
  const setProjectSetting = useSetProjectSetting();
  const createProjectMutation = useCreateProject({
    onSuccess: (project) => {
      const color = PROJECT_COLORS[project.id % PROJECT_COLORS.length];
      setProjectSetting.mutate({ projectId: project.id, key: "color", value: color });
      void queryClient.invalidateQueries({
        queryKey: getListProjectsQueryKey(),
      });
    },
  });
  const deleteProjectMutation = useDeleteProject({
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: getListProjectsQueryKey(),
      });
    },
  });

  // Track which project the create mutation was triggered for
  const pendingProjectIdRef = useRef(0);

  const createFeatureMutation = useCreateFeature({
    onSuccess: (feature) => {
      void queryClient.invalidateQueries({
        queryKey: getListFeaturesQueryKey(pendingProjectIdRef.current),
      });
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(pendingProjectIdRef.current),
          featureId: String(feature.id),
        },
      });
    },
  });

  const createWsSessionMutation = useCreateFeature({
    onSuccess: (wsSession) => {
      void queryClient.invalidateQueries({
        queryKey: getListFeaturesQueryKey(pendingProjectIdRef.current),
      });
      const wsSessionId = wsSessionIdFromFeature(wsSession.id);
      const projectId = pendingProjectIdRef.current;
      const project = projects.find((p) => p.id === projectId);
      void navigate({
        to: "/ws-session/$sessionId",
        params: { sessionId: wsSessionId },
        search: {
          cwd: project?.path ?? "",
          featureId: wsSession.id,
          projectId,
        },
      });
    },
  });

  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [settingsProject, setSettingsProject] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [deleteProject, setDeleteProject] = useState<{
    id: number;
    name: string;
  } | null>(null);

  // Auto-expand the active project
  useEffect(() => {
    if (activeProjectId != null) {
      setExpanded((prev) => ({ ...prev, [activeProjectId]: true }));
    }
  }, [activeProjectId]);

  const toggleExpand = (projectId: number) => {
    setExpanded((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  };

  const handleAddProject = async () => {
    setIsSelectingFolder(true);
    try {
      const folder = await open({ directory: true, multiple: false });
      if (!folder) return;
      const name = folder.split("/").pop() ?? folder;
      createProjectMutation.mutate({ name, path: folder });
    } finally {
      setIsSelectingFolder(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">Projects</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleAddProject}
          disabled={isSelectingFolder || createProjectMutation.isLoading}
        >
          <Plus />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0 min-w-0 overflow-hidden">
        <div className="flex min-w-0 flex-col gap-0.5 px-1">
          {projects.map((project) => {
            const isExpanded = expanded[project.id] ?? false;
            const isActive = activeProjectId === project.id;

            return (
              <div key={project.id}>
                {/* Project row */}
                <button
                  type="button"
                  data-nav-item
                  data-nav-type="project"
                  data-nav-id={String(project.id)}
                  onClick={() => toggleExpand(project.id)}
                  className={`group/project flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-1.5 text-left text-sm outline-none transition-colors ${
                    isActive ? "text-accent-foreground font-medium" : "hover:bg-accent/50"
                  }`}
                >
                  {isExpanded ? (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <ProjectColorDot projectId={project.id} />
                  <span className="min-w-0 truncate">{project.name}</span>

                  <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 group-hover/project:opacity-100">
                    {/* Add feature/session */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <PlusIcon className="h-3.5 w-3.5" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded((prev) => ({
                              ...prev,
                              [project.id]: true,
                            }));
                            pendingProjectIdRef.current = project.id;
                            createFeatureMutation.mutate({
                              project_id: project.id,
                              type: "ws-feature",
                            });
                          }}
                        >
                          New Feature
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded((prev) => ({
                              ...prev,
                              [project.id]: true,
                            }));
                            pendingProjectIdRef.current = project.id;
                            createWsSessionMutation.mutate({
                              project_id: project.id,
                              type: "ws-session",
                            });
                          }}
                        >
                          New Session
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Project menu */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <span
                          role="button"
                          tabIndex={0}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Ellipsis className="h-3.5 w-3.5" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setSettingsProject({
                              id: project.id,
                              name: project.name,
                            });
                          }}
                        >
                          Project Settings
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteProject({
                              id: project.id,
                              name: project.name,
                            });
                          }}
                        >
                          Delete Project
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </button>

                {/* Features (expanded) */}
                {isExpanded && (
                  <ProjectFeatures
                    projectId={project.id}
                    projectPath={project.path}
                    activeFeatureId={isActive ? activeFeatureId : null}
                    featureTurnStates={featureTurnStates}
                    onSelectFeature={onSelectFeature}
                  />
                )}
              </div>
            );
          })}

          {projects.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No projects yet</p>
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

      <ConfirmDialog
        open={deleteProject !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteProject(null);
        }}
        title={`Delete "${deleteProject?.name}"?`}
        description="This will permanently delete the project and all its features, plans, sessions, and settings. This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deleteProject) {
            deleteProjectMutation.mutate({ id: deleteProject.id });
          }
        }}
      />
    </div>
  );
}
