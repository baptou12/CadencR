"use client";

import { useCallback, useEffect, useRef } from "react";
import { GripVertical } from "lucide-react";
import {
  Group,
  Panel,
  Separator,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";
import { popResize, pushResize } from "@/lib/resize-coordinator";

function ResizablePanelGroup({ className, ...props }: GroupProps) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  );
}

function ResizablePanel({ ...props }: PanelProps) {
  return <Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  onPointerDown,
  ...props
}: SeparatorProps & {
  withHandle?: boolean;
}) {
  // Global resize-active flag: heavy `ResizeObserver` consumers (agent stream
  // auto-scroll, xterm refit, …) gate their work on this so a manual drag
  // doesn't trigger a per-frame cascade of forced sync layouts. Each
  // pointerdown opens a window; we close it on the next pointerup/cancel
  // anywhere on the page. Refcounted so concurrent handles are safe even if
  // a future feature adds touch-multitouch resize.
  //
  // The `endRef` lets the unmount cleanup release the global flag if the
  // handle disappears mid-drag (layout change, route swap, …) — otherwise
  // the count would leak and observers would stay throttled forever.
  const endRef = useRef<(() => void) | null>(null);
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pushResize();
      const handle = e.currentTarget;
      const onEnd = (): void => {
        endRef.current = null;
        popResize();
        // react-resizable-panels programmatically focuses the separator on
        // pointerdown to enable arrow-key resize. After a mouse drag the
        // handle keeps focus, which fires the `focus-visible` ring (~3px
        // light bar) and reads as a thick white line until the user clicks
        // elsewhere. Blur explicitly so pointer-driven resizes leave the
        // handle in its resting state.
        handle.blur();
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
      endRef.current = onEnd;
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      onPointerDown?.(e);
    },
    [onPointerDown],
  );

  useEffect(
    () => () => {
      endRef.current?.();
    },
    [],
  );

  // react-resizable-panels v4 emits `aria-orientation` on the Separator (the
  // line direction — opposite of the group's resize axis). We drive sizing and
  // hit-zone positioning off that attribute. Note: v4 does NOT emit
  // `data-panel-group-direction`, so older shadcn templates that key off it
  // silently break vertical resizing — the separator keeps `w-px` and collapses
  // to zero height in a column flexbox.
  //
  // - aria-orientation="vertical"   → vertical line, horizontal panel group
  // - aria-orientation="horizontal" → horizontal line, vertical panel group
  return (
    <Separator
      data-slot="resizable-handle"
      onPointerDown={handlePointerDown}
      className={cn(
        "group relative flex items-center justify-center transition-opacity",
        // Line size per orientation.
        "aria-[orientation=vertical]:w-px",
        "aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full",
        // Dashed gray separator, hover-only: a repeating gradient renders the
        // line as 4px segments of `--border` separated by 4px gaps. A linear
        // mask fades the dashes in/out at the ends so the line feels soft
        // instead of clipped against the pane chrome. Invisible at rest;
        // appears on hover so the split surface stays clean unless the user
        // is about to grab the handle.
        "aria-[orientation=vertical]:hover:[background:repeating-linear-gradient(to_bottom,var(--border)_0_4px,transparent_4px_8px)]",
        "aria-[orientation=vertical]:hover:[mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]",
        "aria-[orientation=horizontal]:hover:[background:repeating-linear-gradient(to_right,var(--border)_0_4px,transparent_4px_8px)]",
        "aria-[orientation=horizontal]:hover:[mask-image:linear-gradient(to_right,transparent,black_20%,black_80%,transparent)]",
        // Generous 16px hit zone via ::after, expanded across the resize axis.
        "after:absolute after:content-['']",
        "aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:-left-2 aria-[orientation=vertical]:after:-right-2",
        "aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:-top-2 aria-[orientation=horizontal]:after:-bottom-2",
        "focus-visible:ring-ring focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden",
        className,
      )}
      {...props}
    >
      {/* Hover grip: a small pill centred on the handle, fading in when the
          user mouses over the hit zone. Makes "this is draggable" obvious
          without painting a permanent UI element. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none z-10 rounded-full bg-foreground/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100",
          "group-aria-[orientation=vertical]:h-8 group-aria-[orientation=vertical]:w-1",
          "group-aria-[orientation=horizontal]:h-1 group-aria-[orientation=horizontal]:w-8",
        )}
      />
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border group-aria-[orientation=horizontal]:rotate-90">
          <GripVertical className="size-2.5" />
        </div>
      )}
    </Separator>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
