import { useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  SettingsIcon,
  FolderPlusIcon,
  FilePlusIcon,
  MessageSquarePlusIcon,
  DiffIcon,
  FileTextIcon,
  MessageSquareIcon,
  ArrowLeftIcon,
  TerminalIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { KbdShortcut } from "@/components/KbdShortcut";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProjects,
  useCreateProject,
  getListProjectsQueryKey,
  useListFeatures,
  getListFeaturesQueryKey,
  useCreateFeature,
} from "../api/generated";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeProjectId: number | null;
  activeFeatureId: number | null;
}

type Mode = "commands" | "pick-project-feature" | "pick-project-session";

function ProjectFeatureGroup({
  projectId,
  projectName,
  onSelect,
}: {
  projectId: number;
  projectName: string;
  onSelect: (projectId: number, featureId: number) => void;
}) {
  const featuresQuery = useListFeatures(projectId);

  if (!featuresQuery.data?.length) return null;

  return (
    <CommandGroup heading={projectName}>
      {featuresQuery.data.map((f: { id: number; title: string; type: string }) => (
        <CommandItem
          key={f.id}
          keywords={[projectName, f.title]}
          onSelect={() => onSelect(projectId, f.id)}
        >
          {f.type === "ws-session" ? (
            <MessageSquareIcon className="mr-2" />
          ) : (
            <FileTextIcon className="mr-2" />
          )}
          <span className="truncate">{f.title}</span>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  activeProjectId,
  activeFeatureId,
}: CommandPaletteProps) {
  const [mode, setMode] = useState<Mode>("commands");
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const projectsQuery = useListProjects();

  const createProjectMutation = useCreateProject({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    },
  });

  const createFeatureMutation = useCreateFeature({
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: getListFeaturesQueryKey(variables.project_id),
      });
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(variables.project_id),
          featureId: String(result.id),
        },
      });
    },
  });

  const createSessionMutation = useCreateFeature({
    onSuccess: (session, variables) => {
      void queryClient.invalidateQueries({
        queryKey: getListFeaturesQueryKey(variables.project_id),
      });
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(variables.project_id),
          featureId: String(session.id),
        },
      });
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
    const folder = await openDialog({ directory: true, multiple: false });
    if (!folder) return;
    const name = folder.split("/").pop() ?? folder;
    createProjectMutation.mutate({ name, path: folder });
    close();
  }, [createProjectMutation, close]);

  const handleNewFeature = useCallback(
    (projectId: number) => {
      createFeatureMutation.mutate({
        project_id: projectId,
        title: "Untitled Feature",
      });
      close();
    },
    [createFeatureMutation, close],
  );

  const handleProjectPick = useCallback(
    (projectId: number) => {
      if (mode === "pick-project-feature") {
        handleNewFeature(projectId);
      } else if (mode === "pick-project-session") {
        createSessionMutation.mutate({ project_id: projectId, type: "ws-session" });
        close();
      }
    },
    [mode, handleNewFeature, createSessionMutation, close],
  );

  const handleOpenDiff = useCallback(() => {
    // Dispatch the same keyboard event that FeatureTopBar listens for
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (mode !== "commands" && e.key === "Backspace" && search === "") {
        e.preventDefault();
        setMode("commands");
      }
    },
    [mode, search],
  );

  // Sort projects: active project first
  const projects = projectsQuery.data ?? [];
  const sortedProjects = activeProjectId
    ? [
        ...projects.filter((p: { id: number }) => p.id === activeProjectId),
        ...projects.filter((p: { id: number }) => p.id !== activeProjectId),
      ]
    : projects;

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
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput
        placeholder="Type a command or search..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Commands">
          <CommandItem
            onSelect={() => {
              void navigate({ to: "/settings" });
              close();
            }}
          >
            <SettingsIcon className="mr-2" />
            Global Settings
            <span className="ml-auto">
              <KbdShortcut keys={["cmd", ","]} />
            </span>
          </CommandItem>
          <CommandItem onSelect={handleNewProject}>
            <FolderPlusIcon className="mr-2" />
            New Project
          </CommandItem>
          <CommandItem
            onSelect={() => {
              if (activeProjectId != null) {
                handleNewFeature(activeProjectId);
              } else {
                setMode("pick-project-feature");
                setSearch("");
              }
            }}
          >
            <FilePlusIcon className="mr-2" />
            New Feature
            <span className="ml-auto">
              <KbdShortcut keys={["cmd", "N"]} />
            </span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              if (activeProjectId != null) {
                createSessionMutation.mutate({
                  project_id: activeProjectId,
                  type: "ws-session",
                });
                close();
              } else {
                setMode("pick-project-session");
                setSearch("");
              }
            }}
          >
            <MessageSquarePlusIcon className="mr-2" />
            New Session
            <span className="ml-auto">
              <KbdShortcut keys={["cmd", "shift", "N"]} />
            </span>
          </CommandItem>
          {activeFeatureId != null && (
            <CommandItem onSelect={handleOpenDiff}>
              <DiffIcon className="mr-2" />
              Open Diff
              <span className="ml-auto">
                <KbdShortcut keys={["cmd", "shift", "D"]} />
              </span>
            </CommandItem>
          )}
          {activeFeatureId != null && (
            <CommandItem
              onSelect={() => {
                // Dispatch Ctrl+` to toggle terminal panel
                window.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "`",
                    code: "Backquote",
                    ctrlKey: true,
                    bubbles: true,
                  }),
                );
                close();
              }}
            >
              <TerminalIcon className="mr-2" />
              Toggle Terminal
              <span className="ml-auto">
                <KbdShortcut keys={["ctrl", "`"]} />
              </span>
            </CommandItem>
          )}
        </CommandGroup>
        {sortedProjects.length > 0 && <CommandSeparator />}
        {sortedProjects.map((p: { id: number; name: string }) => (
          <ProjectFeatureGroup
            key={p.id}
            projectId={p.id}
            projectName={p.name}
            onSelect={handleFeatureSelect}
          />
        ))}
      </CommandList>
    </CommandDialog>
  );
}
