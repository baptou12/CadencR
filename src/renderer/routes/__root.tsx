import React, { useCallback } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { useDbUpdated } from "@/hooks/useDbUpdated";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { PanelSize } from "react-resizable-panels";
import { FocusProvider } from "@/contexts/FocusContext";
import { useAppFocus } from "@/hooks/useAppFocus";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <FocusProvider>
      <RootLayoutInner />
    </FocusProvider>
  );
}

function RootLayoutInner() {
  useDbUpdated();
  const leftWidth = useDebouncedSetting("sidebar_left_width");
  const { focusZone, setFocusZone } = useAppFocus();

  const handleLeftResize = useCallback(
    (panelSize: PanelSize) => {
      leftWidth.setValue(String(Math.round(panelSize.inPixels)));
    },
    [leftWidth],
  );

  const defaultLeftSize = leftWidth.value ? `${leftWidth.value}px` : "256px";

  const focusRingClass = "ring-2 ring-blue-500/50";

  return (
    <div className="flex h-screen" style={{ paddingTop: 28 }}>
      <div
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          height: 28,
          WebkitAppRegion: "drag",
          backgroundColor: "#1a1b26",
        } as React.CSSProperties}
      />
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel
          defaultSize={defaultLeftSize}
          minSize="180px"
          maxSize="400px"
          onResize={handleLeftResize}
        >
          <div
            data-focus-zone="left-sidebar"
            className={`h-full ${focusZone === "left-sidebar" ? focusRingClass : ""}`}
            onClick={() => setFocusZone("left-sidebar")}
          >
            <Sidebar />
          </div>
        </ResizablePanel>
        <ResizableHandle className="cursor-col-resize" />
        <ResizablePanel>
          <main
            data-focus-zone="main-content"
            className={`h-full overflow-hidden ${focusZone === "main-content" ? focusRingClass : ""}`}
            onClick={() => setFocusZone("main-content")}
          >
            <Outlet />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
