import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ClipboardCopyIcon } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { ContextMenuActionButton } from "@/components/ContextMenuActionItem";

interface UniversalContextMenuProps {
  children: ReactNode;
}

interface MenuPosition {
  x: number;
  y: number;
  text: string;
}

/**
 * App-wide fallback context menu offering "Copy" when the user right-clicks
 * on a non-empty text selection, anywhere no more specific menu handles it.
 *
 * Design notes — this MUST NOT wrap the app in a Radix `ContextMenu` /
 * `ContextMenuTrigger`. Doing so puts a `data-slot="context-menu-trigger"`
 * marker on the wrapper that matches `Element.closest()` for every event
 * target in the app, and any capture-phase handler on the wrapper kills the
 * event before per-area Radix triggers (sidebar, file-tree, agent stream)
 * can run their own `onContextMenu` → the OS native menu wins everywhere.
 *
 * Instead we attach a single document-level listener on the *bubble* phase.
 * By the time it runs, any per-area Radix trigger has already called
 * `preventDefault()` on the event; we read `e.defaultPrevented` and bail.
 *
 * Coexistence:
 *   - Inner Radix menus (sidebar / file-tree / agent / tabs / search / bash):
 *     they preventDefault → we bail.
 *   - Native form fields (`input`, `textarea`, `[contenteditable=true]`):
 *     we bail so the OS shows spellcheck / undo / autofill.
 *   - Empty text selection: we bail so right-click on bare whitespace falls
 *     through to the browser default (no-op in the desktop webview).
 */
export default function UniversalContextMenu({ children }: UniversalContextMenuProps) {
  const [menu, setMenu] = useState<MenuPosition | null>(null);

  useEffect(() => {
    function onContextMenu(e: MouseEvent): void {
      if (e.defaultPrevented) return;

      const target = e.target as Element | null;
      if (target?.closest("input, textarea, [contenteditable=true]")) return;

      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      if (!text.trim()) return;

      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, text });
    }

    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Dismiss the floating menu on outside click, Escape, or scroll.
  useEffect(() => {
    if (!menu) return;
    function close(): void {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setMenu(null);
    }
    const scrollOpts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", close, scrollOpts);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", close, scrollOpts);
    };
  }, [menu]);

  async function handleCopy(): Promise<void> {
    if (!menu) return;
    await copyToClipboard(menu.text, "Copied");
    setMenu(null);
  }

  return (
    <>
      {children}
      {menu &&
        createPortal(
          <div
            role="menu"
            className={cn(
              "bg-popover text-popover-foreground fixed z-50 min-w-[8rem] rounded-md border p-1 shadow-md",
            )}
            style={{ top: menu.y, left: menu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ContextMenuActionButton
              icon={ClipboardCopyIcon}
              shortcutKeys={["mod", "c"]}
              onSelect={() => void handleCopy()}
            >
              Copy
            </ContextMenuActionButton>
          </div>,
          document.body,
        )}
    </>
  );
}
