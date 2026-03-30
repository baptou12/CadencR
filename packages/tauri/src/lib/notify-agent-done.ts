import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import type { Project } from "@/api/generated";

let permissionCache: boolean | null = null;

/**
 * Initialize notification permission check.
 * Must be called once at app startup before any notifications are sent.
 * The Rust side waits for macOS authorization before returning.
 */
export async function initNotificationPermission(): Promise<void> {
  try {
    permissionCache = await invoke<boolean>("plugin:notification-router|check_permission");
  } catch {
    permissionCache = false;
  }
}

interface NotifyOptions {
  status: "completed" | "error";
  featureTitle: string;
  featureId: number;
  projectId: number;
  routeType: "workflow" | "session";
}

/**
 * Send a native desktop notification when an agent finishes, unless the user
 * is already viewing that feature. Clicking the notification navigates to
 * the relevant route and focuses the prompt.
 */
export function notifyAgentDone(opts: NotifyOptions): void {
  if (!permissionCache) return;

  const pathname = window.location.pathname;
  if (opts.routeType === "workflow" &&
      pathname === `/projects/${opts.projectId}/features/${opts.featureId}`) return;
  if (opts.routeType === "session" &&
      pathname === `/ws-session/ws-feature-${opts.featureId}`) return;

  void invoke("plugin:notification-router|send_notification", {
    title: opts.status === "completed" ? "Agent finished" : "Agent error",
    body: opts.featureTitle,
    featureId: opts.featureId,
    projectId: opts.projectId,
    routeType: opts.routeType,
  }).catch((e: unknown) => console.warn("[notify] send failed:", e));
}

interface NotificationClickPayload {
  feature_id: number;
  project_id: number;
  route_type: NotifyOptions["routeType"];
}

type NavigateFn = (opts: {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, unknown>;
}) => Promise<void>;

/**
 * Listen for notification clicks and navigate to the relevant route.
 * Returns a cleanup function for use in useEffect.
 */
export function listenForNotificationClicks(
  navigate: NavigateFn,
  queryClient: QueryClient,
): () => void {
  const unlisten = listen<NotificationClickPayload>("notification-clicked", (event) => {
    const { feature_id, project_id, route_type } = event.payload;
    const nav = route_type === "session"
      ? navigate({
          to: "/ws-session/$sessionId",
          params: { sessionId: `ws-feature-${feature_id}` },
          search: { cwd: lookupProjectPath(queryClient, project_id), featureId: feature_id, projectId: project_id },
        })
      : navigate({
          to: "/projects/$projectId/features/$featureId",
          params: { projectId: String(project_id), featureId: String(feature_id) },
        });
    void nav.then(() => {
      setTimeout(() => window.dispatchEvent(new CustomEvent("cadence:focus-prompt")), 100);
    });
  });
  return () => { void unlisten.then(fn => fn()).catch(() => {}); };
}

function lookupProjectPath(queryClient: QueryClient, projectId: number): string {
  for (const [, data] of queryClient.getQueriesData<Project[]>({ queryKey: ["projects", "list"] })) {
    const project = data?.find(p => p.id === projectId);
    if (project) return project.path;
  }
  return "";
}
