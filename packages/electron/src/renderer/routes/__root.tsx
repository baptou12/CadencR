import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  createRootRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useHotkeys } from "react-hotkeys-hook";
import { Sidebar } from "@/components/Sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useDbUpdated } from "@/hooks/useDbUpdated";
import { useOperationToasts } from "@/hooks/useOperationToasts";
import { useDebouncedSetting } from "@/hooks/useDebouncedSetting";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import type { PanelSize } from "react-resizable-panels";
import { trpc } from "@/trpc";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateFeature,
  useDeleteFeature,
  useUpdateFeatureStatus,
  type Feature,
} from "@/api/generated";
import { customInstance } from "@/api/client";
import { getActiveFocusZone } from "@/lib/focus-zones";
import { CommandPalette } from "@/components/CommandPalette";
import { FocusRing } from "@/components/FocusRing";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAppWsStore } from "@/stores/app-ws-store";

const ZONE_ORDER = ["left-sidebar", "main-content", "terminal", "right-sidebar"] as const;

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
  useOperationToasts();
  const leftWidth = useDebouncedSetting("sidebar_left_width");
  const navigate = useNavigate();
  const leftSidebarRef = useRef<HTMLDivElement>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  // Auto-focus left sidebar on mount
  useEffect(() => {
    leftSidebarRef.current?.focus();
  }, []);

  // Connect global app WebSocket for cross-feature events (turn states, etc.)
  useEffect(() => {
    useAppWsStore.getState().connect();
    return () => useAppWsStore.getState().disconnect();
  }, []);

  // Extract active project ID from the current route
  const routerState = useRouterState();
  const routeParams = (routerState.location.pathname.match(
    /\/projects\/(\d+)(?:\/features\/(\d+))?/,
  ) ?? []) as string[];
  const activeProjectId = routeParams[1]
    ? Number(routeParams[1])
    : routerState.location.search?.projectId
      ? Number(routerState.location.search.projectId)
      : null;

  // Extract active feature ID from the current route (fallback to search params for ws-session)
  const activeFeatureId = routeParams[2]
    ? Number(routeParams[2])
    : routerState.location.search?.featureId
      ? Number(routerState.location.search.featureId)
      : null;

  const queryClient = useQueryClient();

  const invalidateFeatures = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["features", "list"] });
    void queryClient.invalidateQueries({ queryKey: ["features", "detail"] });
    void queryClient.invalidateQueries({ queryKey: ["features", "planProgress"] });
  }, [queryClient]);

  const createFeatureMutation = useCreateFeature({
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

  const createSessionMutation = useCreateFeature({
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
  const deleteFeatureMutation = useDeleteFeature({
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

  const archiveNavTargetRef = useRef<number | null>(null);
  const archiveFeatureMutation = useUpdateFeatureStatus({
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
  });

  const [confirmAction, setConfirmAction] = useState<"archive" | "delete" | null>(null);

  // CMD+, -> navigate to settings
  useHotkeys(
    "meta+comma",
    (e) => {
      e.preventDefault();
      void navigate({ to: "/settings" });
    },
    { enableOnFormTags: true },
  );

  // CMD+? -> open keyboard shortcuts help modal
  // Use native keydown because react-hotkeys-hook doesn't reliably catch meta+shift+/ on macOS
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        e.preventDefault();
        setShortcutsHelpOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  // CMD+K -> open command palette
  useHotkeys(
    "meta+k",
    (e) => {
      e.preventDefault();
      setCommandPaletteOpen((prev) => !prev);
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+[ -> cycle focus left
  useHotkeys(
    "meta+alt+left",
    (e) => {
      e.preventDefault();
      focusZoneByDirection("left");
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+] -> cycle focus right
  useHotkeys(
    "meta+alt+right",
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
      createSessionMutation.mutate({ project_id: activeProjectId, type: "session" });
    },
    { enableOnFormTags: true },
  );

  // CMD+SHIFT+X -> archive or delete currently opened feature
  useHotkeys(
    "meta+shift+x",
    async (e) => {
      e.preventDefault();
      if (activeProjectId == null || activeFeatureId == null) return;
      try {
        const features = await customInstance<Feature[]>({ method: "GET", url: `/api/features?project_id=${activeProjectId}` });
        const feature = features.find((f) => f.id === activeFeatureId);
        if (!feature) return;
        // Pre-compute navigation target
        const idx = features.findIndex((f) => f.id === activeFeatureId);
        const remaining = features.filter((f) => f.id !== activeFeatureId);
        const target = idx > 0 ? features[idx - 1] : remaining[0] ?? null;
        if (feature.status === "archived") {
          deleteNavTargetRef.current = target?.id ?? null;
          setConfirmAction("delete");
        } else {
          // Check if feature is empty — if so, skip archive and go straight to delete
          const { empty } = await customInstance<{ empty: boolean }>({ method: "GET", url: `/api/features/${activeFeatureId}/empty` });
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
    <div className="flex h-screen">
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
            className="h-full outline-none"
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
            className="h-full overflow-hidden outline-none"
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
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title={confirmAction === "delete" ? "Delete feature?" : "Archive feature?"}
        description={confirmAction === "delete" ? "This cannot be undone." : undefined}
        confirmText={confirmAction === "delete" ? "Delete" : "Archive"}
        variant={confirmAction === "delete" ? "destructive" : "default"}
        onConfirm={() => {
          if (activeFeatureId == null) return;
          if (confirmAction === "delete") {
            deleteFeatureMutation.mutate({ id: activeFeatureId });
          } else {
            archiveFeatureMutation.mutate({ id: activeFeatureId, status: "archived" });
          }
        }}
      />
    </div>
  );
}
