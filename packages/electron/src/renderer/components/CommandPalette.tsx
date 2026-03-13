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
import { trpc } from "@/trpc";

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
  const featuresQuery = trpc.features.listByProject.useQuery({
    project_id: projectId,
  });

  if (!featuresQuery.data?.length) return null;

  return (
    <CommandGroup heading={projectName}>
      {featuresQuery.data.map(
        (f: { id: number; title: string; type: string }) => (
          <CommandItem
            key={f.id}
            keywords={[projectName, f.title]}
            onSelect={() => onSelect(projectId, f.id)}
          >
            {f.type === "session" ? (
              <MessageSquareIcon className="mr-2" />
            ) : (
              <FileTextIcon className="mr-2" />
            )}
            <span className="truncate">{f.title}</span>
          </CommandItem>
        ),
      )}
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
  const utils = trpc.useUtils();

  const projectsQuery = trpc.projects.list.useQuery();

  const selectFolderMutation = trpc.projects.selectFolder.useMutation();
  const createProjectMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      void utils.projects.list.invalidate();
    },
  });

  const createFeatureMutation = trpc.features.create.useMutation({
    onSuccess: (result, variables) => {
      void utils.features.listByProject.invalidate();
      void navigate({
        to: "/projects/$projectId/features/$featureId",
        params: {
          projectId: String(variables.project_id),
          featureId: String(result.id),
        },
      });
    },
  });

  const createSessionMutation = trpc.features.createSession.useMutation({
    onSuccess: (session, variables) => {
      void utils.features.listByProject.invalidate();
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
    const folder = await selectFolderMutation.mutateAsync();
    if (!folder) return;
    createProjectMutation.mutate({ name: folder.name, path: folder.path });
    close();
  }, [selectFolderMutation, createProjectMutation, close]);

  const handleProjectPick = useCallback(
    (projectId: number) => {
      if (mode === "pick-project-feature") {
        createFeatureMutation.mutate({
          project_id: projectId,
          title: "Untitled Feature",
        });
      } else if (mode === "pick-project-session") {
        createSessionMutation.mutate({ project_id: projectId });
      }
      close();
    },
    [mode, createFeatureMutation, createSessionMutation, close],
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
      if (
        mode !== "commands" &&
        e.key === "Backspace" &&
        search === ""
      ) {
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
        ...projects.filter(
          (p: { id: number }) => p.id === activeProjectId,
        ),
        ...projects.filter(
          (p: { id: number }) => p.id !== activeProjectId,
        ),
      ]
    : projects;

  if (mode !== "commands") {
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
            {sortedProjects.map(
              (p: { id: number; name: string }) => (
                <CommandItem
                  key={p.id}
                  onSelect={() => handleProjectPick(p.id)}
                >
                  <ArrowLeftIcon className="mr-2 opacity-0" />
                  {p.name}
                  {p.id === activeProjectId && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      (current)
                    </span>
                  )}
                </CommandItem>
              ),
            )}
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
            <span className="ml-auto"><KbdShortcut keys={["cmd", ","]} /></span>
          </CommandItem>
          <CommandItem onSelect={handleNewProject}>
            <FolderPlusIcon className="mr-2" />
            New Project
          </CommandItem>
          <CommandItem
            onSelect={() => {
              if (activeProjectId != null) {
                createFeatureMutation.mutate({
                  project_id: activeProjectId,
                  title: "Untitled Feature",
                });
                close();
              } else {
                setMode("pick-project-feature");
                setSearch("");
              }
            }}
          >
            <FilePlusIcon className="mr-2" />
            New Feature
            <span className="ml-auto"><KbdShortcut keys={["cmd", "N"]} /></span>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              if (activeProjectId != null) {
                createSessionMutation.mutate({
                  project_id: activeProjectId,
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
            <span className="ml-auto"><KbdShortcut keys={["cmd", "shift", "N"]} /></span>
          </CommandItem>
          {activeFeatureId != null && (
            <CommandItem onSelect={handleOpenDiff}>
              <DiffIcon className="mr-2" />
              Open Diff
              <span className="ml-auto"><KbdShortcut keys={["cmd", "shift", "D"]} /></span>
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
              <span className="ml-auto"><KbdShortcut keys={["ctrl", "`"]} /></span>
            </CommandItem>
          )}
        </CommandGroup>
        {sortedProjects.length > 0 && <CommandSeparator />}
        {sortedProjects.map(
          (p: { id: number; name: string }) => (
            <ProjectFeatureGroup
              key={p.id}
              projectId={p.id}
              projectName={p.name}
              onSelect={handleFeatureSelect}
            />
          ),
        )}
      </CommandList>
    </CommandDialog>
  );
}
