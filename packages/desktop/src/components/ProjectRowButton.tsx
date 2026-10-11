import { forwardRef, type MouseEventHandler, type ReactElement, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ProjectBadge } from "@/components/ProjectBadge";
import { SidebarShortcutBadge } from "@/components/SidebarShortcutBadge";
import { useNavShortcutHint } from "@/hooks/useNavShortcutHints";

interface ProjectRowButtonProps {
  projectId: number;
  isActive: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}

/** Project row trigger with nav-shortcut registration and a forwarded context-menu ref. */
export const ProjectRowButton = forwardRef<HTMLButtonElement, ProjectRowButtonProps>(
  function ProjectRowButton({ projectId, isActive, onClick, children, ...rest }, forwardedRef) {
    const { navRef, badgeRef } = useNavShortcutHint<HTMLButtonElement>();
    const assignRef = (node: HTMLButtonElement | null): void => {
      navRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    };
    return (
      <button
        ref={assignRef}
        type="button"
        data-nav-item
        data-nav-type="project"
        data-nav-id={String(projectId)}
        onClick={onClick}
        className={`sidebar-project-row group/project relative flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-sm outline-none transition-colors ${
          isActive ? "text-accent-foreground font-medium" : "hover:bg-accent/50"
        }`}
        {...rest}
      >
        <SidebarShortcutBadge ref={badgeRef} />
        {children}
      </button>
    );
  },
);

/** A project row's fold chevron, badge and name: shared by the tree and the display options preview. */
export function ProjectRowLabel({
  projectId,
  name,
  expanded,
}: {
  projectId: number;
  name: string;
  expanded: boolean;
}): ReactElement {
  return (
    <>
      {expanded ? (
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span
        data-sidebar-project-badge
        className="inline-flex size-3.5 shrink-0 items-center justify-center"
      >
        <ProjectBadge projectId={projectId} className="max-w-none" />
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </>
  );
}
