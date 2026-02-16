import React, { useCallback, useEffect, useRef } from "react";
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

  // Extract active feature ID from the current route
  const activeFeatureId = routeParams[2] ? Number(routeParams[2]) : null;

  const utils = trpc.useUtils();

  const invalidateFeatures = useCallback(() => {
    void utils.features.listByProject.invalidate();
    void utils.features.getById.invalidate();
    void utils.features.getProgress.invalidate();
  }, [utils]);

  const createFeatureMutation = trpc.features.create.useMutation({
    onSuccess: (result) => {
      invalidateFeatures();
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

  // Track which feature to navigate to after deletion
  const deleteNavTargetRef = useRef<number | null>(null);
  const deleteFeatureMutation = trpc.features.delete.useMutation({
    onSuccess: () => {
      invalidateFeatures();
      if (activeProjectId == null) return;
      const targetId = deleteNavTargetRef.current;
      deleteNavTargetRef.current = null;
      if (targetId != null) {
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(activeProjectId),
            featureId: String(targetId),
          },
        });
      } else {
        void navigate({ to: "/" });
      }
    },
  });

  // CMD+, -> navigate to settings
  useHotkeys(
    "meta+comma",
    (e) => {
      e.preventDefault();
      void navigate({ to: "/settings" });
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+[ -> cycle focus left
  useHotkeys(
    "meta+shift+bracketleft",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("left");
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+] -> cycle focus right
  useHotkeys(
    "meta+shift+bracketright",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("right");
    },
    { enableOnFormTags: true },
  );

  // CMD+Escape -> stop all running agents globally (with confirmation)
  const stopAllMutation = trpc.agents.stopAll.useMutation();
  useHotkeys(
    "meta+escape",
    (e) => {
      e.preventDefault();
      const confirmed = window.confirm("Stop all running agents across all features and projects?");
      if (!confirmed) return;
      stopAllMutation.mutate();
    },
    { enableOnFormTags: true },
  );

  // CMD+N -> create new feature directly
  useHotkeys(
    "meta+n",
    (e) => {
      e.preventDefault();
      if (activeProjectId == null) return;
      createFeatureMutation.mutate({
        project_id: activeProjectId,
        title: "Untitled Feature",
      });
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+N -> create new session
  useHotkeys(
    "meta+shift+n",
    (e) => {
      e.preventDefault();
      if (activeProjectId == null) return;
      createSessionMutation.mutate({ project_id: activeProjectId });
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+X -> delete currently opened feature, navigate to feature above
  useHotkeys(
    "meta+shift+x",
    async (e) => {
      e.preventDefault();
      if (activeProjectId == null || activeFeatureId == null) return;
      const confirmed = window.confirm("Delete this feature? This cannot be undone.");
      if (!confirmed) return;
      // Navigate to the feature above, or the first remaining feature, or project root
      try {
        const features = await utils.features.listByProject.fetch({ project_id: activeProjectId });
        const idx = features.findIndex((f: { id: number }) => f.id === activeFeatureId);
        const remaining = features.filter((f: { id: number }) => f.id !== activeFeatureId);
        const target = idx > 0 ? features[idx - 1] : remaining[0] ?? null;
        deleteNavTargetRef.current = target?.id ?? null;
      } catch {
        deleteNavTargetRef.current = null;
      }
      deleteFeatureMutation.mutate({ id: activeFeatureId });
    },
    { enableOnFormTags: true },
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
          minSize="240px"
          maxSize="400px"
          onResize={handleLeftResize}
        >
          <div
            ref={leftSidebarRef}
            data-focus-zone="left-sidebar"
            tabIndex={0}
            className="h-full outline-none focus-within:ring-2 focus-within:ring-blue-400/70"
            onFocus={(e) => {
              // When the wrapper itself gets focus via keyboard (not click), move to the first nav item
              if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
                const firstItem = e.currentTarget.querySelector("[data-nav-item]") as HTMLElement | null;
                if (firstItem) firstItem.focus();
              }
            }}
          >
            <Sidebar />
          </div>
        </ResizablePanel>
        <ResizableHandle className="cursor-col-resize" />
        <ResizablePanel>
          <main
            data-focus-zone="main-content"
            tabIndex={0}
            className="h-full overflow-hidden outline-none focus-within:ring-2 focus-within:ring-blue-400/70"
            onFocus={(e) => {
              // When the wrapper itself gets focus via keyboard (not click), move to the first focusable item
              if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
                const firstItem = e.currentTarget.querySelector("[data-nav-item]") as HTMLElement | null;
                if (firstItem) {
                  firstItem.focus();
                } else {
                  // Fallback for session view: focus the prompt bar textarea
                  const textarea = e.currentTarget.querySelector("textarea") as HTMLElement | null;
                  if (textarea) textarea.focus();
                }
              }
            }}
          >
            <Outlet />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>

    </div>
  );
}
