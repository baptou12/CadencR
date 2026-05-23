import { memo, useCallback, type ReactElement, type ReactNode } from "react";
import { ResizableSidebarLayout } from "@/components/ResizableSidebarLayout";

interface EditorSidebarLayoutProps {
  sidebarVisible: boolean;
  sidebar: ReactNode;
  editor: ReactNode;
  onToggleSidebar: () => void;
}

const DEFAULT_WIDTH = 220;
const MIN_WIDTH = 120;
const MAX_WIDTH = 500;

function EditorSidebarLayoutImpl({
  sidebarVisible,
  sidebar,
  editor,
  onToggleSidebar,
}: EditorSidebarLayoutProps): ReactElement {
  const collapsed = !sidebarVisible;
  const handleCollapsedChange = useCallback(
    (nextCollapsed: boolean): void => {
      if (nextCollapsed !== collapsed) onToggleSidebar();
    },
    [collapsed, onToggleSidebar],
  );

  return (
    <ResizableSidebarLayout
      collapsed={collapsed}
      sidebar={sidebar}
      content={editor}
      onCollapsedChange={handleCollapsedChange}
      defaultWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      expandButtonLabel="Show file tree sidebar"
      expandButtonTitle="Show sidebar"
      expandShortcutKeys={["cmd", "E"]}
      separatorLabel="Resize file tree sidebar"
    />
  );
}

export const EditorSidebarLayout = memo(EditorSidebarLayoutImpl);
