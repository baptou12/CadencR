import { type ReactElement, type ReactNode } from "react";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { cn } from "@/lib/utils";

interface MobileDrawerProps {
  /** Whether the drawer is hidden (slid off-canvas to the left). */
  collapsed: boolean;
  /** Dismiss the drawer — wired to the backdrop tap and the swipe-left. */
  onClose: () => void;
  /**
   * Reveal the drawer — wired to the left-edge swipe. Omit it (as the editor's
   * nested file-tree drawer does) to leave the screen edge alone; swipe-to-close
   * on the panel is always on either way.
   */
  onOpen?: () => void;
  /** Accessible label for the backdrop dismiss button. */
  closeLabel: string;
  /** Drawer contents (the sidebar/tree). */
  children: ReactNode;
}

/**
 * Off-canvas left drawer for mobile sidebars: a dimmed backdrop plus an 85vw
 * panel that slides in from the left. Render it as the last children of a
 * `relative` container — it positions `absolute` within that container (not
 * `fixed`) so it tracks the shell height on iOS standalone, where a `fixed` box
 * resolves to the short top-anchored viewport and would clip the bottom.
 *
 * Shared by the app shell (`AppShell`) and the editor's file-tree layout
 * (`EditorSidebarLayout`) so the backdrop, width, slide animation, and swipe
 * gestures live in one place.
 */
export function MobileDrawer({
  collapsed,
  onClose,
  onOpen,
  closeLabel,
  children,
}: MobileDrawerProps): ReactElement {
  // The edge strip claims the touch before the browser can read it as a
  // back-navigation gesture (see `blockNativeGesture`), so a swipe in from the
  // left opens the drawer instead of leaving the session.
  const edgeRef = useSwipeGesture({
    enabled: collapsed,
    direction: "right",
    onSwipe: () => onOpen?.(),
    blockNativeGesture: true,
  });
  const panelRef = useSwipeGesture({
    enabled: !collapsed,
    direction: "left",
    onSwipe: onClose,
  });

  return (
    <>
      {onOpen != null && (
        <div
          ref={edgeRef}
          data-drawer-edge-swipe
          aria-hidden
          // Narrow enough that the only chrome it overlaps is empty gutter —
          // `SidebarCollapsedChrome` insets the mobile menu button clear of it.
          // Sits under the drawer/backdrop (z-30) so it never eats their touches.
          className="absolute inset-y-0 left-0 z-30 w-4 touch-none"
        />
      )}
      <button
        type="button"
        aria-label={closeLabel}
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "absolute inset-0 z-40 bg-black/50 transition-opacity duration-200",
          collapsed ? "pointer-events-none opacity-0" : "opacity-100",
        )}
      />
      <div
        ref={panelRef}
        data-drawer-panel
        className={cn(
          "absolute inset-y-0 left-0 z-50 w-[85vw] max-w-xs transform shadow-xl transition-transform duration-200 ease-out",
          collapsed ? "-translate-x-full" : "translate-x-0",
        )}
      >
        {children}
      </div>
    </>
  );
}
