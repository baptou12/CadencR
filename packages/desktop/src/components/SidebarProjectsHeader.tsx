import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarProjectsHeaderProps {
  onAddProject: () => void;
  isAddingProject: boolean;
  canAddProject: boolean;
  onRefresh: () => void;
  isRefreshing: boolean;
}

/**
 * "Projects" sidebar header: section label plus the add-project and
 * re-sort (manual refresh) actions. Refresh re-adopts the backend's
 * most-recent-user-message ordering for projects (see `useOrderedProjects`).
 */
export function SidebarProjectsHeader({
  onAddProject,
  isAddingProject,
  canAddProject,
  onRefresh,
  isRefreshing,
}: SidebarProjectsHeaderProps) {
  return (
    <div className="group flex items-center justify-between px-2">
      <span className="text-xs font-semibold uppercase text-muted-foreground">Projects</span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Re-sort projects"
          aria-label="Re-sort projects"
          className="can-hover:opacity-0 can-hover:transition-opacity can-hover:focus-visible:opacity-100 can-hover:group-hover:opacity-100"
        >
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
        </Button>
        {canAddProject ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onAddProject}
            disabled={isAddingProject}
            title="Add project"
            aria-label="Add project"
            className="can-hover:opacity-0 can-hover:transition-opacity can-hover:focus-visible:opacity-100 can-hover:group-hover:opacity-100"
          >
            <Plus />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
