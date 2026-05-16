import { useCallback, useEffect, useRef, useState } from "react";
import { useGlobalShortcutById, useShortcut } from "@/hooks/useShortcut";
import { createRootRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";
import { toast } from "sonner";
import { useOperationToasts } from "@/hooks/useOperationToasts";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateFeature,
  useDeleteFeature,
  useUpdateFeatureStatus,
  type Feature,
} from "@/api/generated";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { customInstance } from "@/api/client";
import { useSessionStatusStore } from "@/stores/session-status-store";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { isTurnActive } from "@/stores/ws-turn-lifecycle";
import { useZoomHotkeys } from "@/hooks/useZoom";
import { useConnectionWatchdog } from "@/hooks/useConnectionWatchdog";
import { usePowerEvents } from "@/hooks/usePowerEvents";
import { usePowerBusySignal } from "@/hooks/usePowerBusySignal";
import { SuspendedBanner } from "@/components/SuspendedBanner";
import {
  initNotificationPermission,
  listenForNotificationClicks,
  listenForNotificationFailures,
  listenForNotificationFallbacks,
} from "@/lib/notify-agent-done";
import { useAppClose } from "@/hooks/useAppClose";
import { SidebarContext } from "@/components/SidebarContext";
import { useThemeSync } from "@/hooks/useTheme";
import UniversalContextMenu from "@/components/UniversalContextMenu";
import { RootOverlays } from "@/components/RootOverlays";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useOperationToasts();
  useThemeSync();
  useConnectionWatchdog();
  usePowerEvents();
  usePowerBusySignal();
  const leftWidth = useDebouncedSetting("sidebar_left_width", 300, { immediateCache: false });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const leftSidebarRef = useRef<HTMLDivElement>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const sidebarCollapsed = useDebouncedSetting("sidebar_collapsed", 0);
  const isSidebarCollapsed = sidebarCollapsed.value === "true";
  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => sidebarCollapsed.setValue(collapsed ? "true" : "false"),
    [sidebarCollapsed],
  );
  const sidebarPanelRef = useRef<PanelImperativeHandle>(null);

  useEffect(() => {
    if (sidebarCollapsed.isLoading) return;
    const panel = sidebarPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed() === isSidebarCollapsed) return;
    if (isSidebarCollapsed) panel.collapse();
    else panel.expand();
  }, [sidebarCollapsed.isLoading, isSidebarCollapsed]);

  useEffect(() => {
    leftSidebarRef.current?.focus();
  }, []);
  useEffect(() => {
    useSessionStatusStore.getState().connect();
    return () => useSessionStatusStore.getState().disconnect();
  }, []);
  useEffect(() => {
    void initNotificationPermission();
  }, []);
  useEffect(() => listenForNotificationClicks(navigate, queryClient), [navigate, queryClient]);
  useEffect(() => listenForNotificationFallbacks(navigate, queryClient), [navigate, queryClient]);
  useEffect(() => listenForNotificationFailures(), []);
  const routerState = useRouterState();
  const routeParams = (routerState.location.pathname.match(
    /\/projects\/(\d+)(?:\/features\/(\d+))?/,
  ) ?? []) as string[];
  const activeProjectId = routeParams[1]
    ? Number(routeParams[1])
    : routerState.location.search?.projectId
      ? Number(routerState.location.search.projectId)
      : null;

  const activeFeatureId = routeParams[2]
    ? Number(routeParams[2])
    : routerState.location.search?.featureId
      ? Number(routerState.location.search.featureId)
      : null;

  const invalidateFeatures = useCallback(() => {
    // Catch every feature-scoped cache: list, detail, plan, plan/progress, etc.
    void invalidateByUrlPrefix(queryClient, "/api/features");
  }, [queryClient]);

  const createSessionMutation = useCreateFeature({
    mutation: {
      onSuccess: (session) => {
        invalidateFeatures();
        if (activeProjectId == null) return;
        // Routes through the legacy feature route, which immediately redirects
        // to the ws-session route once `useListProjects()` resolves the cwd.
        void navigate({
          to: "/projects/$projectId/features/$featureId",
          params: {
            projectId: String(activeProjectId),
            featureId: String(session.id),
          },
        });
      },
    },
  });

  // Track which feature to navigate to after deletion
  const deleteNavTargetRef = useRef<number | null>(null);
  const deleteFeatureMutation = useDeleteFeature({
    mutation: {
      onError: () => {
        toast.error("Failed to delete feature");
      },
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
    },
  });

  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);
  const archiveFeatureMutation = useUpdateFeatureStatus({
    mutation: {
      onError: () => {
        toast.error("Failed to archive session");
      },
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
    },
  });
  const handleConfirmFeatureAction = useCallback((): void => {
    if (activeFeatureId == null) return;
    if (confirmAction === "archive") {
      archiveFeatureMutation.mutate({
        id: activeFeatureId,
        data: { status: "archived" },
      });
      return;
    }
    deleteFeatureMutation.mutate({ id: activeFeatureId });
  }, [activeFeatureId, archiveFeatureMutation, confirmAction, deleteFeatureMutation]);

  useZoomHotkeys();

  const appClose = useAppClose(queryClient);

  useShortcut("toggle-sidebar", (e) => {
    e.preventDefault();
    setSidebarCollapsed(!isSidebarCollapsed);
  });

  useShortcut("open-settings", (e) => {
    e.preventDefault();
    void navigate({ to: "/settings" });
  });

  useGlobalShortcutById("shortcuts-help", (e) => {
    e.preventDefault();
    setShortcutsHelpOpen((prev) => !prev);
  });

  // Stop all running agents across the app.
  useShortcut("stop-all-agents", (e) => {
    const store = useWsSessionStore.getState();
    const sessions = store.sessions;
    let stopped = false;
    for (const sessionId of Object.keys(sessions)) {
      if (isTurnActive(sessions[sessionId].lifecycle)) {
        store.interrupt(sessionId);
        stopped = true;
      }
    }
    if (stopped) e.preventDefault();
  });

  useShortcut("command-palette", (e) => {
    e.preventDefault();
    setCommandPaletteOpen((prev) => !prev);
  });

  useShortcut("new-session", (e) => {
    e.preventDefault();
    if (activeProjectId == null) return;
    createSessionMutation.mutate({ data: { project_id: activeProjectId, type: "ws-session" } });
  });

  // Archive active features, delete archived features.
  useShortcut("delete-feature", async (e) => {
    e.preventDefault();
    if (activeProjectId == null || activeFeatureId == null) return;
    try {
      const features = await customInstance<Feature[]>({
        method: "GET",
        url: `/api/features?project_id=${activeProjectId}&include_archived=true`,
      });
      const feature = features.find((f) => f.id === activeFeatureId);
      if (!feature) return;
      const activeFeatures = features.filter((f) => f.status === "active");
      const idx = activeFeatures.findIndex((f) => f.id === activeFeatureId);
      const remaining = activeFeatures.filter((f) => f.id !== activeFeatureId);
      const target = idx > 0 ? activeFeatures[idx - 1] : (remaining[0] ?? null);
      deleteNavTargetRef.current = target?.id ?? null;
      setConfirmAction(feature.status === "archived" ? "delete" : "archive");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load features");
    }
  });

  const handleLayoutChanged = useCallback(() => {
    const size = sidebarPanelRef.current?.getSize();
    if (!size || size.inPixels < 50) return;
    leftWidth.setValue(String(Math.round(size.inPixels)));
  }, [leftWidth]);

  const defaultLeftSize = leftWidth.value ? `${leftWidth.value}px` : "256px";

  return (
    <SidebarContext.Provider
      value={{ collapsed: isSidebarCollapsed, setCollapsed: setSidebarCollapsed }}
    >
      <UniversalContextMenu>
        <div className="flex h-screen">
          <ResizablePanelGroup orientation="horizontal" onLayoutChanged={handleLayoutChanged}>
            <ResizablePanel
              id="sidebar"
              panelRef={sidebarPanelRef}
              collapsible
              collapsedSize={0}
              defaultSize={defaultLeftSize}
              minSize="200px"
              maxSize="400px"
            >
              <div
                ref={leftSidebarRef}
                data-focus-zone="left-sidebar"
                tabIndex={0}
                className="h-full outline-none"
                onFocus={(e) => {
                  if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
                    const firstItem = e.currentTarget.querySelector(
                      "[data-nav-item]",
                    ) as HTMLElement | null;
                    if (firstItem) firstItem.focus();
                  }
                }}
              >
                <Sidebar />
              </div>
            </ResizablePanel>
            <ResizableHandle
              className={cn(
                "cursor-col-resize",
                isSidebarCollapsed && "pointer-events-none opacity-0",
              )}
            />
            <ResizablePanel id="main">
              <main
                data-focus-zone="main-content"
                tabIndex={0}
                className="h-full overflow-hidden outline-none"
                onFocus={(e) => {
                  if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
                    const firstItem = e.currentTarget.querySelector(
                      "[data-nav-item]",
                    ) as HTMLElement | null;
                    if (firstItem) {
                      firstItem.focus();
                    } else {
                      const textarea = e.currentTarget.querySelector(
                        "textarea",
                      ) as HTMLElement | null;
                      if (textarea) textarea.focus();
                    }
                  }
                }}
              >
                <RootErrorBoundary>
                  <div
                    key={routerState.location.pathname}
                    className="h-full animate-in fade-in-0 duration-200 ease-out"
                  >
                    <Outlet />
                  </div>
                </RootErrorBoundary>
              </main>
            </ResizablePanel>
          </ResizablePanelGroup>
          <SuspendedBanner />
          <RootOverlays
            commandPaletteOpen={commandPaletteOpen}
            setCommandPaletteOpen={setCommandPaletteOpen}
            activeProjectId={activeProjectId}
            activeFeatureId={activeFeatureId}
            shortcutsHelpOpen={shortcutsHelpOpen}
            setShortcutsHelpOpen={setShortcutsHelpOpen}
            confirmAction={confirmAction}
            setConfirmAction={setConfirmAction}
            onConfirmFeatureAction={handleConfirmFeatureAction}
            appClose={appClose}
          />
        </div>
      </UniversalContextMenu>
    </SidebarContext.Provider>
  );
}
