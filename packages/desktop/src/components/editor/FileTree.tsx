import { memo } from "react";
import { CadencrFileTree } from "@/components/file-tree/CadencrFileTree";
import { useFileTreeController, type FileTreeProps } from "./useFileTreeController";

function FileTree(props: FileTreeProps) {
  const controller = useFileTreeController(props);
  return (
    <div
      ref={controller.containerRef}
      className="flex h-full flex-col"
      onKeyDown={controller.handleKeyDown}
      onClick={controller.handleClick}
    >
      <CadencrFileTree
        model={controller.model}
        isLoading={controller.isLoading}
        errorMessage={controller.errorMessage}
        renderContextMenu={controller.renderContextMenu}
        aria-label="Project file tree"
      />
    </div>
  );
}

export default memo(FileTree);
