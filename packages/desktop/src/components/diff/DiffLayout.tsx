import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";

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

interface DragState {
  startX: number;
  startWidth: number;
  frame: number | null;
}

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)));
}

function DiffLayoutImpl(props: DiffLayoutProps) {
  const { collapsed, controlled, disabled, sidebar, content, onCollapsedChange } = props;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const dragStateRef = useRef<DragState | null>(null);

  const onResizeMove = useCallback((event: PointerEvent): void => {
    const state = dragStateRef.current;
    if (!state) return;
    const nextWidth = clampWidth(state.startWidth + event.clientX - state.startX);
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = requestAnimationFrame(() => {
      setSidebarWidth(nextWidth);
      if (dragStateRef.current) dragStateRef.current.frame = null;
    });
  }, []);

  const endResize = useCallback((): void => {
    const state = dragStateRef.current;
    if (state?.frame != null) cancelAnimationFrame(state.frame);
    dragStateRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onResizeMove);
    window.removeEventListener("pointerup", endResize);
    window.removeEventListener("pointercancel", endResize);
  }, [onResizeMove]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      dragStateRef.current = {
        startX: event.clientX,
        startWidth: sidebarWidth,
        frame: null,
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", endResize);
      window.addEventListener("pointercancel", endResize);
    },
    [endResize, onResizeMove, sidebarWidth],
  );

  useEffect(() => endResize, [endResize]);

  const columnTemplate = collapsed
    ? `${controlled ? 0 : 36}px 0px minmax(0, 1fr)`
    : `${sidebarWidth}px 1px minmax(0, 1fr)`;

  return (
    <div
      className="grid min-h-0 flex-1 overflow-hidden"
      style={{ gridTemplateColumns: columnTemplate }}
    >
      <div className="min-w-0 overflow-hidden">
        {collapsed && !controlled ? (
          <div className="flex h-full justify-center border-r border-border bg-card pt-2">
            <button
              type="button"
              title="Expand file list"
              aria-label="Expand Git file list"
              className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              disabled={disabled}
              onClick={() => onCollapsedChange(false)}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          </div>
        ) : (
          sidebar
        )}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Git file list"
        className="group relative cursor-col-resize bg-border"
        onPointerDown={collapsed ? undefined : startResize}
      >
        {!collapsed && (
          <>
            <div className="absolute inset-y-0 -left-2 -right-2" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
          </>
        )}
      </div>
      <div className="min-w-0 overflow-hidden">{content}</div>
    </div>
  );
}

export const DiffLayout = memo(DiffLayoutImpl);
