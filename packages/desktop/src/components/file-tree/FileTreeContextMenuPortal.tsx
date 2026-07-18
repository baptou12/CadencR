import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuOpenContext } from "@pierre/trees";
import { cn } from "@/lib/utils";

const VIEWPORT_PADDING = 8;

interface FileTreeContextMenuPortalProps {
  context: ContextMenuOpenContext;
  children: ReactNode;
  className?: string;
}

/** Portaled, viewport-aware menu surface shared by Pierre tree consumers. */
export function FileTreeContextMenuPortal({
  context,
  children,
  className,
}: FileTreeContextMenuPortalProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999, opacity: 0 });

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    const menuRect = element.getBoundingClientRect();
    const anchor = context.anchorRect;
    let left = anchor.left;
    if (left + menuRect.width > window.innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, anchor.right - menuRect.width);
    }
    let top = anchor.bottom;
    if (top + menuRect.height > window.innerHeight - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, anchor.top - menuRect.height);
    }
    setPosition({ top, left, opacity: 1 });
  }, [context.anchorRect]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-file-tree-context-menu-root="true"
      className={cn(
        "fixed z-50 min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1",
        "text-popover-foreground shadow-md",
        className,
      )}
      style={position}
    >
      {children}
    </div>,
    document.body,
  );
}
