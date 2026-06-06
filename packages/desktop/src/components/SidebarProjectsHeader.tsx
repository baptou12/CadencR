import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarProjectsHeaderProps {
  onAddProject: () => void;
  isAddingProject: boolean;
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
  onRefresh,
  isRefreshing,
}: SidebarProjectsHeaderProps) {
  return (
    <div className="flex items-center justify-between px-2">
      <span className="text-xs font-semibold uppercase text-muted-foreground">Projects</span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Re-sort projects"
          aria-label="Re-sort projects"
        >
          <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onAddProject}
          disabled={isAddingProject}
          title="Add project"
          aria-label="Add project"
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}
