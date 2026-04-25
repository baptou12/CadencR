import { useCallback, useEffect, useRef, useState } from "react";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import { createRootRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { useOperationToasts } from "@/hooks/useOperationToasts";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import type { PanelSize } from "react-resizable-panels";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateFeature,
  useDeleteFeature,
  useUpdateFeatureStatus,
  type Feature,
} from "@/api/generated";
import { invalidateByUrlPrefix } from "@/lib/queryClient";
import { customInstance } from "@/api/client";
import { focusZoneByDirection } from "@/lib/focus-zones";
import { CommandPalette } from "@/components/CommandPalette";
import { FocusRing } from "@/components/FocusRing";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAppWsStore } from "@/stores/app-ws-store";
import { useWsSessionStore } from "@/stores/ws-session-store";
import { isTurnActive } from "@/stores/ws-turn-lifecycle";
import { useZoomHotkeys } from "@/hooks/useZoom";
import { initNotificationPermission, listenForNotificationClicks } from "@/lib/notify-agent-done";
import { useAppClose } from "@/hooks/useAppClose";
import { SidebarContext } from "@/components/SidebarContext";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  useOperationToasts();
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

  useEffect(() => {
    leftSidebarRef.current?.focus();
  }, []);
  useEffect(() => {
    useAppWsStore.getState().connect();
    return () => useAppWsStore.getState().disconnect();
  }, []);
  useEffect(() => {
    void initNotificationPermission();
  }, []);
  useEffect(() => listenForNotificationClicks(navigate, queryClient), [navigate, queryClient]);
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

  const createFeatureMutation = useCreateFeature({
    mutation: {
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
    },
  });

  const createSessionMutation = useCreateFeature({
    mutation: {
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

  const archiveNavTargetRef = useRef<number | null>(null);
  const archiveFeatureMutation = useUpdateFeatureStatus({
    mutation: {
      onSuccess: () => {
        invalidateFeatures();
        if (activeProjectId == null) return;
        const targetId = archiveNavTargetRef.current;
        archiveNavTargetRef.current = null;
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

  useZoomHotkeys();

  const appClose = useAppClose(queryClient);

  // CMD+B -> toggle sidebar
  useHotkeys(
    "meta+b",
    (e) => {
      e.preventDefault();
      setSidebarCollapsed(!isSidebarCollapsed);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+, -> navigate to settings
  useHotkeys(
    "meta+comma",
    (e) => {
      e.preventDefault();
      void navigate({ to: "/settings" });
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+/ -> open keyboard shortcuts help modal.
  // Industry-standard shortcut (Slack, Discord, GitHub) that avoids macOS's
  // reserved Cmd+Shift+? Help menu accelerator entirely.
  useGlobalShortcut("meta+/", (e) => {
    e.preventDefault();
    setShortcutsHelpOpen((prev) => !prev);
  });

  // CMD+Escape -> stop all running agents across the app
  useHotkeys(
    "meta+escape",
    (e) => {
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
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+K -> open command palette
  useHotkeys(
    "meta+k",
    (e) => {
      e.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+SHIFT+[ -> cycle focus left
  useHotkeys(
    "meta+alt+left",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("left");
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+SHIFT+] -> cycle focus right
  useHotkeys(
    "meta+alt+right",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("right");
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+N -> create new feature directly
  useHotkeys(
    "meta+n",
    (e) => {
      e.preventDefault();
      if (activeProjectId == null) return;
      createFeatureMutation.mutate({
        data: { project_id: activeProjectId, title: "Untitled Feature" },
      });
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+SHIFT+N -> create new session
  useHotkeys(
    "meta+shift+n",
    (e) => {
      e.preventDefault();
      if (activeProjectId == null) return;
      createSessionMutation.mutate({ data: { project_id: activeProjectId, type: "ws-session" } });
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  // CMD+SHIFT+X -> archive or delete currently opened feature
  useHotkeys(
    "meta+shift+x",
    async (e) => {
      e.preventDefault();
      if (activeProjectId == null || activeFeatureId == null) return;
      try {
        const features = await customInstance<Feature[]>({
          method: "GET",
          url: `/api/features?project_id=${activeProjectId}`,
        });
        const feature = features.find((f) => f.id === activeFeatureId);
        if (!feature) return;
        // Pre-compute navigation target
        const idx = features.findIndex((f) => f.id === activeFeatureId);
        const remaining = features.filter((f) => f.id !== activeFeatureId);
        const target = idx > 0 ? features[idx - 1] : (remaining[0] ?? null);
        if (feature.status === "archived") {
          deleteNavTargetRef.current = target?.id ?? null;
          setConfirmAction("delete");
        } else {
          // Check if feature is empty — if so, skip archive and go straight to delete
          const { empty } = await customInstance<{ empty: boolean }>({
            method: "GET",
            url: `/api/features/${activeFeatureId}/empty`,
          });
          if (empty) {
            deleteNavTargetRef.current = target?.id ?? null;
            setConfirmAction("delete");
          } else {
            archiveNavTargetRef.current = target?.id ?? null;
            setConfirmAction("archive");
          }
        }
      } catch {
        // ignore fetch errors
      }
    },
    { enableOnFormTags: true, enableOnContentEditable: true },
  );

  const handleLeftResize = useCallback(
    (panelSize: PanelSize) => {
      leftWidth.setValue(String(Math.round(panelSize.inPixels)));
    },
    [leftWidth],
  );

  const defaultLeftSize = leftWidth.value ? `${leftWidth.value}px` : "256px";

  return (
    <SidebarContext.Provider
      value={{ collapsed: isSidebarCollapsed, setCollapsed: setSidebarCollapsed }}
    >
      <div className="flex h-screen">
        <ResizablePanelGroup orientation="horizontal">
          {!isSidebarCollapsed && (
            <>
              <ResizablePanel
                defaultSize={defaultLeftSize}
                minSize="200px"
                maxSize="400px"
                onResize={handleLeftResize}
              >
                <div
                  ref={leftSidebarRef}
                  data-focus-zone="left-sidebar"
                  tabIndex={0}
                  className="h-full outline-none"
                  onFocus={(e) => {
                    // When the wrapper itself gets focus via keyboard (not click), move to the first nav item
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
              <ResizableHandle className="cursor-col-resize" />
            </>
          )}
          <ResizablePanel>
            <main
              data-focus-zone="main-content"
              tabIndex={0}
              className="h-full overflow-hidden outline-none"
              onFocus={(e) => {
                // When the wrapper itself gets focus via keyboard (not click), move to the first focusable item
                if (e.target === e.currentTarget && !e.currentTarget.matches(":active")) {
                  const firstItem = e.currentTarget.querySelector(
                    "[data-nav-item]",
                  ) as HTMLElement | null;
                  if (firstItem) {
                    firstItem.focus();
                  } else {
                    // Fallback for session view: focus the prompt bar textarea
                    const textarea = e.currentTarget.querySelector(
                      "textarea",
                    ) as HTMLElement | null;
                    if (textarea) textarea.focus();
                  }
                }
              }}
            >
              <Outlet />
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
        <CommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          activeProjectId={activeProjectId}
          activeFeatureId={activeFeatureId}
        />
        <KeyboardShortcutsModal open={shortcutsHelpOpen} onOpenChange={setShortcutsHelpOpen} />
        <Toaster position="top-center" richColors />
        <FocusRing />
        <ConfirmDialog
          open={confirmAction != null}
          onOpenChange={(open) => {
            if (!open) setConfirmAction(null);
          }}
          title={confirmAction === "delete" ? "Delete feature?" : "Archive feature?"}
          description={confirmAction === "delete" ? "This cannot be undone." : undefined}
          confirmText={confirmAction === "delete" ? "Delete" : "Archive"}
          variant={confirmAction === "delete" ? "destructive" : "default"}
          onConfirm={() => {
            if (activeFeatureId == null) return;
            if (confirmAction === "delete") {
              deleteFeatureMutation.mutate({ id: activeFeatureId });
            } else {
              archiveFeatureMutation.mutate({
                id: activeFeatureId,
                data: { status: "archived" },
              });
            }
          }}
        />
        <ConfirmDialog
          open={appClose.showConfirm}
          onOpenChange={appClose.setShowConfirm}
          title="Quit Cadence?"
          description="The following agents are still running. They will be stopped and can be resumed next time you open the app."
          confirmText="Quit"
          variant="destructive"
          onConfirm={appClose.confirmAndClose}
        >
          <ul className="text-sm text-muted-foreground space-y-1 py-2">
            {appClose.runningAgents.map((agent) => (
              <li key={agent.sessionId}>{agent.label}</li>
            ))}
          </ul>
        </ConfirmDialog>
      </div>
    </SidebarContext.Provider>
  );
}
