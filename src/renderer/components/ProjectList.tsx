import { Ellipsis, Plus } from "lucide-react";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProjectListProps {
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

export function ProjectList({
  selectedProjectId,
  onSelectProject,
}: ProjectListProps) {
  const utils = trpc.useUtils();
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
              onClick={() => onSelectProject(project.id)}
              className={`group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
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
    </div>
  );
}
