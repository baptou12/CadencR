import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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

function useCommandPaletteState(props: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>("commands");
  const [search, setSearch] = useState("");
  const [pendingProjectId, setPendingProjectId] = useState<number | null>(null);
  const [worktreeChoice, setWorktreeChoice] = useState<WorktreeChoiceValue>({ mode: "new" });
  const worktreeChoiceTouchedRef = useRef(false);
  const projectsQuery = useListProjects();
  const projectSettingsQuery = useGetProjectSettings(pendingProjectId ?? 0, {
    query: { enabled: pendingProjectId != null },
  });
  const projectDefaultWorktreeMode = defaultWorktreeModeFromSettings(projectSettingsQuery.data);
  useEffect(() => {
    if (mode !== "pick-worktree-mode" || worktreeChoiceTouchedRef.current) return;
    setWorktreeChoice(projectDefaultWorktreeMode === "skip" ? { mode: "skip" } : { mode: "new" });
  }, [mode, projectDefaultWorktreeMode]);
  const sortedProjects = useMemo(() => {
    const projects = projectsQuery.data ?? [];
    if (!props.activeProjectId) return projects;
    return [
      ...projects.filter((project) => project.id === props.activeProjectId),
      ...projects.filter((project) => project.id !== props.activeProjectId),
    ];
  }, [projectsQuery.data, props.activeProjectId]);
  return useMemo(
    () => ({
      mode,
      pendingProjectId,
      projectDefaultWorktreeMode,
      search,
      setMode,
      setPendingProjectId,
      setSearch,
      setWorktreeChoice,
      sortedProjects,
      worktreeChoice,
      worktreeChoiceTouchedRef,
    }),
    [mode, pendingProjectId, projectDefaultWorktreeMode, search, sortedProjects, worktreeChoice],
  );
}

type CommandPaletteState = ReturnType<typeof useCommandPaletteState>;

function useCommandPaletteMutations(
  props: CommandPaletteProps,
  navigate: ReturnType<typeof useNavigate>,
) {
  const queryClient = useQueryClient();
  const createProject = useCreateProject({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      },
    },
  });
  const createAndNavigate = (
    result: { id: number },
    variables: { data: CreateFeatureRequest },
  ): void => {
    void queryClient.invalidateQueries({
      queryKey: getListFeaturesQueryKey({ project_id: variables.data.project_id }),
    });
    void navigate({
      to: "/projects/$projectId/features/$featureId",
      params: { projectId: String(variables.data.project_id), featureId: String(result.id) },
    });
  };
  const createFeature = useCreateFeature({ mutation: { onSuccess: createAndNavigate } });
  const createSession = useCreateFeature({ mutation: { onSuccess: createAndNavigate } });
  const setProjectSetting = useSetProjectSetting();
  return useMemo(
    () => ({ createFeature, createProject, createSession, setProjectSetting }),
    [createFeature, createProject, createSession, setProjectSetting],
  );
}

type CommandPaletteMutations = ReturnType<typeof useCommandPaletteMutations>;

function useWorktreePaletteActions(
  state: CommandPaletteState,
  mutations: CommandPaletteMutations,
  close: () => void,
) {
  const startWorktreePick = useCallback(
    (projectId: number) => {
      state.setPendingProjectId(projectId);
      state.setWorktreeChoice({ mode: "new" });
      state.worktreeChoiceTouchedRef.current = false;
      state.setSearch("");
      state.setMode("pick-worktree-mode");
    },
    [state],
  );
  const handleWorktreeChoiceChange = useCallback(
    (value: WorktreeChoiceValue) => {
      state.worktreeChoiceTouchedRef.current = true;
      state.setWorktreeChoice(value);
    },
    [state],
  );
  const confirmCreateFeature = useCallback(async () => {
    if (state.pendingProjectId == null || !isWorktreeChoiceValid(state.worktreeChoice)) return;
    const choice = state.worktreeChoice;
    if (choice.mode !== "reuse" && choice.mode !== state.projectDefaultWorktreeMode) {
      try {
        await mutations.setProjectSetting.mutateAsync({
          id: state.pendingProjectId,
          data: { key: DEFAULT_WORKTREE_MODE_KEY, value: choice.mode },
        });
      } catch (error) {
        toast.error(apiErrorMessage(error, "Failed to save worktree preference"));
        return;
      }
    }
    const data: CreateFeatureRequest = {
      project_id: state.pendingProjectId,
      title: "Untitled Feature",
      worktree_mode: choice.mode,
    };
    if (choice.mode === "reuse") data.reuse_branch = choice.branch;
    mutations.createFeature.mutate({ data });
    close();
  }, [close, mutations, state]);
  return useMemo(
    () => ({ confirmCreateFeature, handleWorktreeChoiceChange, startWorktreePick }),
    [confirmCreateFeature, handleWorktreeChoiceChange, startWorktreePick],
  );
}

type WorktreePaletteActions = ReturnType<typeof useWorktreePaletteActions>;

function dispatchPaletteShortcut(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
}

function useCommandPaletteActions(
  props: CommandPaletteProps,
  state: CommandPaletteState,
  mutations: CommandPaletteMutations,
  worktree: WorktreePaletteActions,
  navigate: ReturnType<typeof useNavigate>,
  close: () => void,
) {
  const handleFeatureSelect = useCallback(
    (projectId: number, featureId: number) => {
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: { projectId: String(projectId), featureId: String(featureId) },
      });
      close();
    },
    [close, navigate],
  );
  const handleNewProject = useCallback(async () => {
    const folder = await desktopBridge.pickDirectory();
    if (!folder) return;
    mutations.createProject.mutate({
      data: { name: folder.split("/").pop() ?? folder, path: folder },
    });
    close();
  }, [close, mutations.createProject]);
  const handleProjectPick = useCallback(
    (projectId: number) => {
      if (state.mode === "pick-project-feature") worktree.startWorktreePick(projectId);
      else if (state.mode === "pick-project-session") {
        mutations.createSession.mutate({ data: { project_id: projectId, type: "ws-session" } });
        close();
      }
    },
    [close, mutations.createSession, state.mode, worktree.startWorktreePick],
  );
  const handleNewFeature = useCallback(() => {
    if (props.activeProjectId != null) worktree.startWorktreePick(props.activeProjectId);
    else {
      state.setMode("pick-project-feature");
      state.setSearch("");
    }
  }, [props.activeProjectId, state, worktree.startWorktreePick]);
  const handleNewSession = useCallback(() => {
    if (props.activeProjectId != null) {
      mutations.createSession.mutate({
        data: { project_id: props.activeProjectId, type: "ws-session" },
      });
      close();
    } else {
      state.setMode("pick-project-session");
      state.setSearch("");
    }
  }, [close, mutations.createSession, props.activeProjectId, state]);
  return useMemo(
    () => ({
      handleFeatureSelect,
      handleNewFeature,
      handleNewProject,
      handleNewSession,
      handleOpenDiff: () => {
        dispatchPaletteShortcut({ key: "D", code: "KeyD", metaKey: true, shiftKey: true });
        close();
      },
      handleOpenSettings: () => {
        void navigate({ to: "/settings" });
        close();
      },
      handleProjectPick,
      handleToggleTerminal: () => {
        dispatchPaletteShortcut({ key: "`", code: "Backquote", ctrlKey: true });
        close();
      },
    }),
    [
      close,
      handleFeatureSelect,
      handleNewFeature,
      handleNewProject,
      handleNewSession,
      handleProjectPick,
      navigate,
    ],
  );
}

export function CommandPalette(props: CommandPaletteProps) {
  const state = useCommandPaletteState(props);
  const navigate = useNavigate();
  const close = useCallback(() => props.onOpenChange(false), [props.onOpenChange]);
  const mutations = useCommandPaletteMutations(props, navigate);
  const worktree = useWorktreePaletteActions(state, mutations, close);
  const actions = useCommandPaletteActions(props, state, mutations, worktree, navigate, close);
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        state.setMode("commands");
        state.setSearch("");
        state.setPendingProjectId(null);
        state.setWorktreeChoice({ mode: "new" });
        state.worktreeChoiceTouchedRef.current = false;
      }
      props.onOpenChange(open);
    },
    [props.onOpenChange, state],
  );
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (state.mode === "pick-worktree-mode") {
        if (event.key === "Escape" || (event.key === "Backspace" && state.search === "")) {
          event.preventDefault();
          state.setSearch("");
          state.setMode(props.activeProjectId == null ? "pick-project-feature" : "commands");
          if (props.activeProjectId != null) state.setPendingProjectId(null);
        } else if (event.key === "Enter" && isWorktreeChoiceValid(state.worktreeChoice)) {
          event.preventDefault();
          void worktree.confirmCreateFeature();
        }
      } else if (state.mode !== "commands" && event.key === "Backspace" && state.search === "") {
        event.preventDefault();
        state.setMode("commands");
      }
    },
    [props.activeProjectId, state, worktree.confirmCreateFeature],
  );
  if (state.mode === "pick-worktree-mode" && state.pendingProjectId != null) {
    return (
      <CommandPaletteWorktreeStep
        open={props.open}
        onOpenChange={handleOpenChange}
        projectId={state.pendingProjectId}
        value={state.worktreeChoice}
        onChange={worktree.handleWorktreeChoiceChange}
        onConfirm={worktree.confirmCreateFeature}
        onKeyDown={handleKeyDown}
      />
    );
  }
  if (state.mode === "pick-project-feature" || state.mode === "pick-project-session") {
    return (
      <CommandPaletteProjectStep
        props={props}
        state={state}
        actions={actions}
        onOpenChange={handleOpenChange}
        onKeyDown={handleKeyDown}
      />
    );
  }
  return (
    <CommandPaletteCommands
      open={props.open}
      onOpenChange={handleOpenChange}
      search={state.search}
      onSearchChange={state.setSearch}
      sortedProjects={state.sortedProjects}
      activeFeatureId={props.activeFeatureId}
      onOpenSettings={actions.handleOpenSettings}
      onNewProject={actions.handleNewProject}
      onNewFeature={actions.handleNewFeature}
      onNewSession={actions.handleNewSession}
      onOpenDiff={actions.handleOpenDiff}
      onToggleTerminal={actions.handleToggleTerminal}
      onFeatureSelect={actions.handleFeatureSelect}
    />
  );
}

function CommandPaletteProjectStep({
  props,
  state,
  actions,
  onOpenChange,
  onKeyDown,
}: {
  props: CommandPaletteProps;
  state: CommandPaletteState;
  actions: ReturnType<typeof useCommandPaletteActions>;
  onOpenChange: (open: boolean) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <CommandDialog open={props.open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={`Pick a project for new ${state.mode === "pick-project-feature" ? "feature" : "session"}...`}
        value={state.search}
        onValueChange={state.setSearch}
        onKeyDown={onKeyDown}
      />
      <CommandList>
        <CommandEmpty>No projects found.</CommandEmpty>
        <CommandGroup heading="Projects">
          {state.sortedProjects.map((project) => (
            <CommandItem key={project.id} onSelect={() => actions.handleProjectPick(project.id)}>
              <ArrowLeftIcon className="mr-2 opacity-0" />
              {project.name}
              {project.id === props.activeProjectId && (
                <span className="text-muted-foreground ml-2 text-xs">(current)</span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
