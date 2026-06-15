import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";

export type FileTreeContextMenuItem = ContextMenuItem;
export type FileTreeContextMenuOpenContext = ContextMenuOpenContext;
import { cn } from "@/lib/utils";

interface MenuItemSpec {
  label: string;
  shortcut?: string;
  destructive?: boolean;
  onSelect: () => void;
}

interface FileTreeContextMenuProps {
  item: FileTreeContextMenuItem;
  context: FileTreeContextMenuOpenContext;
  /**
   * Called with a verb-keyed action when the user picks a menu item. The
   * caller is responsible for closing pierre's context menu via
   * `context.close()` — typically done from inside the action handler before
   * opening a follow-up dialog or popover.
   */
  onAction: (
    action: "new-file" | "new-folder" | "open" | "copy-path" | "reveal" | "rename" | "delete",
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext,
  ) => void;
}

const VIEWPORT_PADDING = 8;

/**
 * Build the menu spec for an item — files get an `Open` entry, directories
 * skip it. Order matches the user's expected verb sequence.
 */
function buildMenuItems(
  item: FileTreeContextMenuItem,
  context: FileTreeContextMenuOpenContext,
  onAction: FileTreeContextMenuProps["onAction"],
): MenuItemSpec[] {
  const isDir = item.kind === "directory";
  const items: MenuItemSpec[] = [
    { label: "New File…", onSelect: () => onAction("new-file", item, context) },
    { label: "New Folder…", onSelect: () => onAction("new-folder", item, context) },
  ];
  if (!isDir) {
    items.push({ label: "Open", onSelect: () => onAction("open", item, context) });
  }
  items.push(
    { label: "Copy Path", onSelect: () => onAction("copy-path", item, context) },
    { label: "Reveal in File Manager", onSelect: () => onAction("reveal", item, context) },
    { label: "Rename", shortcut: "↵", onSelect: () => onAction("rename", item, context) },
    {
      label: "Move to Trash",
      shortcut: "⌘⌫",
      destructive: true,
      onSelect: () => onAction("delete", item, context),
    },
  );
  return items;
}

/**
 * Pierre renders our menu inside its own positioned slot, which lives in
 * the same stacking context as the file tree — that means the editor (and
 * any panel with `position: relative`) can paint on top of it, and the
 * menu can spill below the viewport. We bypass both problems by
 * portalling to `document.body` and computing our own position from
 * pierre's `anchorRect`, flipping when the menu would overflow.
 */
export function FileTreeContextMenu({
  item,
  context,
  onAction,
}: FileTreeContextMenuProps): React.JSX.Element {
  const items = buildMenuItems(item, context, onAction);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Pre-render off-screen so the first paint of the menu is already in
  // its final, flipped position. Avoids a one-frame flash near edges.
  const [pos, setPos] = useState<{ top: number; left: number; opacity: number }>({
    top: -9999,
    left: -9999,
    opacity: 0,
  });

  // Position once on mount based on pierre's anchor rect, flipping if the
  // measured menu would overflow the viewport on either axis. We only run
  // this once — pierre dismisses on scroll/resize anyway.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const anchor = context.anchorRect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer below-right of the anchor's top-left, matching pierre's
    // default. Flip if it would overflow.
    let left = anchor.left;
    if (left + rect.width > vw - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, anchor.right - rect.width);
    }
    let top = anchor.bottom;
    if (top + rect.height > vh - VIEWPORT_PADDING) {
      top = Math.max(VIEWPORT_PADDING, anchor.top - rect.height);
    }
    setPos({ top, left, opacity: 1 });
  }, [context.anchorRect]);

  // The shortcut hints in the menu (↵, ⌘⌫) are served by the tree-level
  // key handler in `FileTree.tsx`, which already binds these to the
  // focused row. We deliberately don't add a document-level listener
  // here — it would race with the tree handler and fire the action twice.

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-file-tree-context-menu-root="true"
      // z-50 is `--z-popover`-tier; the editor pane sits below. We use a
      // numeric class instead of an arbitrary `z-[…]` so it composes with
      // shadcn's dialog/popover layers.
      className={cn(
        "fixed z-50 min-w-[12rem] overflow-hidden rounded-md border border-border bg-popover p-1",
        "text-popover-foreground shadow-md",
      )}
      style={{ top: pos.top, left: pos.left, opacity: pos.opacity }}
    >
      {items.map((entry, index) => (
        <MenuRow
          key={`${index}-${entry.label}`}
          label={entry.label}
          shortcut={entry.shortcut}
          destructive={entry.destructive}
          onSelect={entry.onSelect}
        />
      ))}
    </div>,
    document.body,
  );
}

function MenuRow({
  label,
  shortcut,
  destructive,
  onSelect,
}: {
  label: string;
  shortcut?: string;
  destructive?: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1 text-left text-sm outline-none transition-colors",
        "hover:bg-accent focus-visible:bg-accent",
        destructive && "text-destructive focus-visible:bg-destructive/10 hover:bg-destructive/10",
      )}
    >
      <span className="truncate">{label}</span>
      {shortcut ? <ShortcutLabel destructive={destructive}>{shortcut}</ShortcutLabel> : null}
    </button>
  );
}

function ShortcutLabel({
  destructive,
  children,
}: {
  destructive?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "ml-auto text-[10px] font-mono",
        destructive ? "text-destructive/70" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
