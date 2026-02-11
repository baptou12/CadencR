import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { trpc } from "@/trpc";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ProjectListProps {
  selectedProjectId: number | null;
  onSelectProject: (id: number) => void;
}

export function ProjectList({
  selectedProjectId,
  onSelectProject,
}: ProjectListProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  const utils = trpc.useUtils();
  const projectsQuery = trpc.projects.list.useQuery();
  const createMutation = trpc.projects.create.useMutation({
    onSuccess: () => {
      void utils.projects.list.invalidate();
      setName("");
      setPath("");
      setDialogOpen(false);
    },
  });
  const deleteMutation = trpc.projects.delete.useMutation({
    onSuccess: () => {
      void utils.projects.list.invalidate();
    },
  });

  const projects = projectsQuery.data ?? [];

  const handleCreate = () => {
    if (!name.trim() || !path.trim()) return;
    createMutation.mutate({ name: name.trim(), path: path.trim() });
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
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon-xs">
              <Plus />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Project</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <Input
                placeholder="Project name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                placeholder="Folder path"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreate}
                disabled={
                  !name.trim() || !path.trim() || createMutation.isLoading
                }
              >
                {createMutation.isLoading ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <ScrollArea className="max-h-64">
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
              <Button
                variant="ghost"
                size="icon-xs"
                className="opacity-0 group-hover:opacity-100"
                onClick={(e) => handleDelete(e, project.id)}
              >
                <Trash2 />
              </Button>
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
