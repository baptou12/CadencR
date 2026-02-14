import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createRootRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Sidebar } from "@/components/Sidebar";
import { useDbUpdated } from "@/hooks/useDbUpdated";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { PanelSize } from "react-resizable-panels";
import { trpc } from "@/trpc";
import { getActiveFocusZone } from "@/lib/focus-zones";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const ZONE_ORDER = ["left-sidebar", "main-content", "right-sidebar"] as const;

function focusZoneByDirection(direction: "left" | "right") {
  const currentZone = getActiveFocusZone();
  const currentIndex = currentZone ? ZONE_ORDER.indexOf(currentZone as (typeof ZONE_ORDER)[number]) : -1;
  const step = direction === "right" ? 1 : -1;
  // Move in the given direction, skipping zones not in the DOM. No wrapping.
  for (let next = currentIndex + step; next >= 0 && next < ZONE_ORDER.length; next += step) {
    const nextEl = document.querySelector(
      `[data-focus-zone="${ZONE_ORDER[next]}"]`,
    ) as HTMLElement | null;
    if (nextEl) {
      nextEl.focus();
      return;
    }
  }
}

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useDbUpdated();
  const leftWidth = useDebouncedSetting("sidebar_left_width");
  const navigate = useNavigate();
  const leftSidebarRef = useRef<HTMLDivElement>(null);

  // Auto-focus left sidebar on mount
  useEffect(() => {
    leftSidebarRef.current?.focus();
  }, []);

  // Extract active project ID from the current route
  const routerState = useRouterState();
  const routeParams = (routerState.location.pathname.match(
    /\/projects\/(\d+)(?:\/features\/(\d+))?/,
  ) ?? []) as string[];
  const activeProjectId = routeParams[1] ? Number(routeParams[1]) : null;

  // New feature dialog state
  const [featureDialogOpen, setFeatureDialogOpen] = useState(false);
  const [newFeatureTitle, setNewFeatureTitle] = useState("");

  const utils = trpc.useUtils();

  const invalidateFeatures = useCallback(() => {
    void utils.features.listByProject.invalidate();
    void utils.features.getById.invalidate();
    void utils.features.getProgress.invalidate();
  }, [utils]);

  const createFeatureMutation = trpc.features.create.useMutation({
    onSuccess: (result) => {
      invalidateFeatures();
      setFeatureDialogOpen(false);
      setNewFeatureTitle("");
      if (activeProjectId != null) {
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(activeProjectId),
            featureId: String(result.id),
          },
        });
      }
    },
  });

  const createSessionMutation = trpc.features.createSession.useMutation({
    onSuccess: (session) => {
      invalidateFeatures();
      if (activeProjectId != null) {
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(activeProjectId),
            featureId: String(session.id),
          },
        });
      }
    },
  });

  const handleCreateFeature = useCallback(() => {
    const trimmed = newFeatureTitle.trim();
    if (!trimmed || activeProjectId == null) return;
    createFeatureMutation.mutate({
      project_id: activeProjectId,
      title: trimmed,
    });
  }, [newFeatureTitle, activeProjectId, createFeatureMutation]);

  // CMD+, -> navigate to settings
  useHotkeys(
    "meta+comma",
    (e) => {
      e.preventDefault();
      void navigate({ to: "/settings" });
    },
    { enableOnFormTags: true },
  );

  // CMD+OPT+LEFT -> cycle focus left
  useHotkeys(
    "meta+alt+left",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("left");
    },
    { enableOnFormTags: true },
  );

  // CMD+OPT+RIGHT -> cycle focus right
  useHotkeys(
    "meta+alt+right",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("right");
    },
    { enableOnFormTags: true },
  );

  // CMD+N -> create new feature (open dialog)
  useHotkeys(
    "meta+n",
    (e) => {
      e.preventDefault();
      if (activeProjectId == null) return;
      setFeatureDialogOpen(true);
    },
    { enableOnFormTags: false },
  );

  // CMD+SHIFT+N -> create new session
  useHotkeys(
    "meta+shift+n",
    (e) => {
      e.preventDefault();
      if (activeProjectId == null) return;
      createSessionMutation.mutate({ project_id: activeProjectId });
    },
    { enableOnFormTags: false },
  );

  const handleLeftResize = useCallback(
    (panelSize: PanelSize) => {
      leftWidth.setValue(String(Math.round(panelSize.inPixels)));
    },
    [leftWidth],
  );

  const defaultLeftSize = leftWidth.value ? `${leftWidth.value}px` : "256px";

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
            ref={leftSidebarRef}
            data-focus-zone="left-sidebar"
            tabIndex={0}
            className="h-full outline-none focus-within:ring-2 focus-within:ring-blue-500/50"
          >
            <Sidebar />
          </div>
        </ResizablePanel>
        <ResizableHandle className="cursor-col-resize" />
        <ResizablePanel>
          <main
            data-focus-zone="main-content"
            tabIndex={0}
            className="h-full overflow-hidden outline-none focus-within:ring-2 focus-within:ring-blue-500/50"
          >
            <Outlet />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* New Feature dialog triggered by CMD+N */}
      <Dialog open={featureDialogOpen} onOpenChange={setFeatureDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Feature</DialogTitle>
            <DialogDescription>
              Enter a title for the new feature.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Feature title"
            value={newFeatureTitle}
            onChange={(e) => setNewFeatureTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFeature();
            }}
          />
          <DialogFooter>
            <Button
              onClick={handleCreateFeature}
              disabled={
                !newFeatureTitle.trim() || createFeatureMutation.isLoading
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
