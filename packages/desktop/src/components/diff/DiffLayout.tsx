import { memo, type ReactElement, type ReactNode } from "react";
import { ResizableSidebarLayout } from "@/components/ResizableSidebarLayout";

interface DiffLayoutProps {
  collapsed: boolean;
  controlled: boolean;
  disabled: boolean;
  sidebar: ReactNode;
  content: ReactNode;
  onCollapsedChange: (collapsed: boolean) => void;
}

const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;

function DiffLayoutImpl({
  collapsed,
  controlled,
  disabled,
  sidebar,
  content,
  onCollapsedChange,
}: DiffLayoutProps): ReactElement {
  return (
    <ResizableSidebarLayout
      collapsed={collapsed}
      disabled={disabled}
      sidebar={sidebar}
      content={content}
      onCollapsedChange={onCollapsedChange}
      defaultWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      showCollapsedRail={!controlled}
      expandButtonLabel="Expand Git file list"
      expandButtonTitle="Expand file list"
      separatorLabel="Resize Git file list"
      className="min-h-0 flex-1"
    />
  );
}

export const DiffLayout = memo(DiffLayoutImpl);
