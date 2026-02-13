import React from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { useDbUpdated } from "@/hooks/useDbUpdated";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useDbUpdated();

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
          defaultSize="256px"
          minSize="180px"
          maxSize="400px"
        >
          <Sidebar />
        </ResizablePanel>
        <ResizableHandle className="cursor-col-resize" />
        <ResizablePanel>
          <main className="h-full overflow-auto p-6">
            <Outlet />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
