import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeftIcon } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
  getListFeaturesQueryKey,
  useCreateFeature,
  useGetProjectSettings,
  useSetProjectSetting,
  type CreateFeatureRequest,
} from "../api/generated";
import { desktopBridge } from "@/lib/desktop-bridge";
import {
  isWorktreeChoiceValid,
  type WorktreeChoiceValue,
} from "@/components/command-palette/WorktreeChoice";
import { CommandPaletteWorktreeStep } from "@/components/command-palette/CommandPaletteWorktreeStep";
import { CommandPaletteCommands } from "@/components/command-palette/CommandPaletteCommands";
import { apiErrorMessage } from "@/lib/api-errors";
import {
  DEFAULT_WORKTREE_MODE_KEY,
  defaultWorktreeModeFromSettings,
} from "@/lib/default-worktree-mode";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: number | null;
  activeFeatureId: number | null;
}

type Mode = "commands" | "pick-project-feature" | "pick-project-session" | "pick-worktree-mode";

export function CommandPalette({
  open,
  onOpenChange,
  activeProjectId,
  activeFeatureId,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>("commands");
  const [search, setSearch] = useState("");
  const [pendingProjectId, setPendingProjectId] = useState<number | null>(null);
  const [worktreeChoice, setWorktreeChoice] = useState<WorktreeChoiceValue>({ mode: "new" });
  // Tracks whether the user has explicitly picked a worktree mode/branch in the
  // current step. Guards the "apply project default" effect below from
  // clobbering that pick when the async project-settings query settles.
  const worktreeChoiceTouchedRef = useRef(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectsQuery = useListProjects();
  const projectSettingsQuery = useGetProjectSettings(pendingProjectId ?? 0, {
    query: { enabled: pendingProjectId != null },
  });
  const setProjectSetting = useSetProjectSetting();
  const projectDefaultWorktreeMode = defaultWorktreeModeFromSettings(projectSettingsQuery.data);

  const createProjectMutation = useCreateProject({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      },
    },
  });

  const createFeatureMutation = useCreateFeature({
    mutation: {
      onSuccess: (result, variables) => {
        void queryClient.invalidateQueries({
          queryKey: getListFeaturesQueryKey({ project_id: variables.data.project_id }),
        });
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(variables.data.project_id),
            featureId: String(result.id),
          },
        });
      },
    },
  });

  const createSessionMutation = useCreateFeature({
    mutation: {
      onSuccess: (session, variables) => {
        void queryClient.invalidateQueries({
          queryKey: getListFeaturesQueryKey({ project_id: variables.data.project_id }),
        });
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(variables.data.project_id),
            featureId: String(session.id),
          },
        });
      },
    },
  });

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setMode("commands");
        setSearch("");
        setPendingProjectId(null);
        setWorktreeChoice({ mode: "new" });
        worktreeChoiceTouchedRef.current = false;
      }
      onOpenChange(open);
    },
    [onOpenChange],
  );
  const handleFeatureSelect = useCallback(
    (projectId: number, featureId: number) => {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(projectId),
          featureId: String(featureId),
        },
      });
      close();
    },
    [navigate, close],
  );

  const handleNewProject = useCallback(async () => {
    const folder = await desktopBridge.pickDirectory();
    if (!folder) return;
    const name = folder.split("/").pop() ?? folder;
    createProjectMutation.mutate({ data: { name, path: folder } });
    close();
  }, [createProjectMutation, close]);
  const startWorktreePick = useCallback((projectId: number) => {
    setPendingProjectId(projectId);
    setWorktreeChoice({ mode: "new" });
    worktreeChoiceTouchedRef.current = false;
    setSearch("");
    setMode("pick-worktree-mode");
  }, []);

  const handleWorktreeChoiceChange = useCallback((value: WorktreeChoiceValue) => {
    worktreeChoiceTouchedRef.current = true;
    setWorktreeChoice(value);
  }, []);

  // Seed the worktree step with the project's saved default once settings load.
  // Skipped after the user picks a mode/branch so the async settle of
  // `projectDefaultWorktreeMode` never overwrites an explicit "reuse" choice.
  useEffect(() => {
    if (mode !== "pick-worktree-mode") return;
    if (worktreeChoiceTouchedRef.current) return;
    setWorktreeChoice(projectDefaultWorktreeMode === "skip" ? { mode: "skip" } : { mode: "new" });
  }, [mode, projectDefaultWorktreeMode]);

  const handleConfirmCreateFeature = useCallback(async () => {
    if (pendingProjectId == null) return;
    if (!isWorktreeChoiceValid(worktreeChoice)) return;
    if (worktreeChoice.mode !== "reuse" && worktreeChoice.mode !== projectDefaultWorktreeMode) {
      try {
        await setProjectSetting.mutateAsync({
          id: pendingProjectId,
          data: { key: DEFAULT_WORKTREE_MODE_KEY, value: worktreeChoice.mode },
        });
      } catch (err) {
        toast.error(apiErrorMessage(err, "Failed to save worktree preference"));
        return;
      }
    }
    const data: CreateFeatureRequest = {
      project_id: pendingProjectId,
      title: "Untitled Feature",
      worktree_mode: worktreeChoice.mode,
    };
    if (worktreeChoice.mode === "reuse") {
      data.reuse_branch = worktreeChoice.branch;
    }
    createFeatureMutation.mutate({ data });
    close();
  }, [
    pendingProjectId,
    worktreeChoice,
    projectDefaultWorktreeMode,
    setProjectSetting,
    createFeatureMutation,
    close,
  ]);
  const handleProjectPick = useCallback(
    (projectId: number) => {
      if (mode === "pick-project-feature") {
        startWorktreePick(projectId);
      } else if (mode === "pick-project-session") {
        createSessionMutation.mutate({ data: { project_id: projectId, type: "ws-session" } });
        close();
      }
    },
    [mode, startWorktreePick, createSessionMutation, close],
  );

  const handleOpenDiff = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "D",
        code: "KeyD",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    close();
  }, [close]);

  const handleOpenSettings = useCallback(() => {
    void navigate({ to: "/settings" });
    close();
  }, [navigate, close]);

  const handleNewFeature = useCallback(() => {
    if (activeProjectId != null) {
      startWorktreePick(activeProjectId);
    } else {
      setMode("pick-project-feature");
      setSearch("");
    }
  }, [activeProjectId, startWorktreePick]);

  const handleNewSession = useCallback(() => {
    if (activeProjectId != null) {
      createSessionMutation.mutate({
        data: { project_id: activeProjectId, type: "ws-session" },
      });
      close();
    } else {
      setMode("pick-project-session");
      setSearch("");
    }
  }, [activeProjectId, createSessionMutation, close]);

  const handleToggleTerminal = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "`",
        code: "Backquote",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    close();
  }, [close]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode === "pick-worktree-mode") {
        if (e.key === "Escape" || (e.key === "Backspace" && search === "")) {
          e.preventDefault();
          setSearch("");
          if (activeProjectId == null) {
            setMode("pick-project-feature");
          } else {
            setMode("commands");
            setPendingProjectId(null);
          }
        } else if (e.key === "Enter" && isWorktreeChoiceValid(worktreeChoice)) {
          e.preventDefault();
          handleConfirmCreateFeature();
        }
        return;
      }
      if (mode !== "commands" && e.key === "Backspace" && search === "") {
        e.preventDefault();
        setMode("commands");
      }
    },
    [mode, search, worktreeChoice, activeProjectId, handleConfirmCreateFeature],
  );

  const projects = projectsQuery.data ?? [];
  const sortedProjects = activeProjectId
    ? [
        ...projects.filter((p: { id: number }) => p.id === activeProjectId),
        ...projects.filter((p: { id: number }) => p.id !== activeProjectId),
      ]
    : projects;

  if (mode === "pick-worktree-mode" && pendingProjectId != null) {
    return (
      <CommandPaletteWorktreeStep
        open={open}
        onOpenChange={handleOpenChange}
        projectId={pendingProjectId}
        value={worktreeChoice}
        onChange={handleWorktreeChoiceChange}
        onConfirm={handleConfirmCreateFeature}
        onKeyDown={handleKeyDown}
      />
    );
  }

  if (mode === "pick-project-feature" || mode === "pick-project-session") {
    return (
      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <CommandInput
          placeholder={`Pick a project for new ${mode === "pick-project-feature" ? "feature" : "session"}...`}
          value={search}
          onValueChange={setSearch}
          onKeyDown={handleKeyDown}
        />
        <CommandList>
          <CommandEmpty>No projects found.</CommandEmpty>
          <CommandGroup heading="Projects">
            {sortedProjects.map((p: { id: number; name: string }) => (
              <CommandItem key={p.id} onSelect={() => handleProjectPick(p.id)}>
                <ArrowLeftIcon className="mr-2 opacity-0" />
                {p.name}
                {p.id === activeProjectId && (
                  <span className="text-muted-foreground ml-2 text-xs">(current)</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    );
  }

  return (
    <CommandPaletteCommands
      open={open}
      onOpenChange={handleOpenChange}
      search={search}
      onSearchChange={setSearch}
      sortedProjects={sortedProjects}
      activeFeatureId={activeFeatureId}
      onOpenSettings={handleOpenSettings}
      onNewProject={handleNewProject}
      onNewFeature={handleNewFeature}
      onNewSession={handleNewSession}
      onOpenDiff={handleOpenDiff}
      onToggleTerminal={handleToggleTerminal}
      onFeatureSelect={handleFeatureSelect}
    />
  );
}
