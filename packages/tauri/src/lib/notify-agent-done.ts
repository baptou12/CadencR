import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { QueryClient } from "@tanstack/react-query";
import { getListProjectsQueryKey, type Project } from "@/api/generated";

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
  status: "completed" | "error" | "needs_input";
  featureTitle: string;
  featureId: number;
  projectId: number;
  routeType: "workflow" | "session";
  /** Agent kind label, e.g. "Execute", "Review" */
  agentKind?: string;
  /** Agent-specific title, e.g. phase title */
  agentTitle?: string;
}

function isViewingFeature(opts: NotifyOptions): boolean {
  const pathname = window.location.pathname;
  if (
    opts.routeType === "workflow" &&
    pathname === `/projects/${opts.projectId}/features/${opts.featureId}`
  )
    return true;
  if (opts.routeType === "session" && pathname === `/ws-session/ws-feature-${opts.featureId}`)
    return true;
  return false;
}

function titleForStatus(status: NotifyOptions["status"]): string {
  switch (status) {
    case "completed":
      return "Agent finished";
    case "error":
      return "Agent error";
    case "needs_input":
      return "Agent needs input";
  }
}

/**
 * Send a native desktop notification for agent events (completion, error,
 * or waiting for user input), unless the user is already viewing that feature.
 * Clicking the notification navigates to the relevant route and focuses the prompt.
 */
export function notifyAgentDone(opts: NotifyOptions): void {
  if (!permissionCache) return;
  if (isViewingFeature(opts)) return;

  const bodyParts = [opts.featureTitle];
  if (opts.agentKind) {
    bodyParts.push(opts.agentTitle ? `${opts.agentKind}: ${opts.agentTitle}` : opts.agentKind);
  }

  void invoke("plugin:notification-router|send_notification", {
    title: titleForStatus(opts.status),
    body: bodyParts.join("\n"),
    featureId: opts.featureId,
    projectId: opts.projectId,
    routeType: opts.routeType,
  }).catch((e: unknown) => console.warn("[notify] send failed:", e));
}

/**
 * Convenience wrapper: notify that an agent is waiting for user input.
 */
export function notifyAgentNeedsInput(opts: Omit<NotifyOptions, "status">): void {
  notifyAgentDone({ ...opts, status: "needs_input" });
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
    const nav =
      route_type === "session"
        ? navigate({
            to: "/ws-session/$sessionId",
            params: { sessionId: `ws-feature-${feature_id}` },
            search: {
              cwd: lookupProjectPath(queryClient, project_id),
              featureId: feature_id,
              projectId: project_id,
            },
          })
        : navigate({
            to: "/projects/$projectId/features/$featureId",
            params: { projectId: String(project_id), featureId: String(feature_id) },
          });
    void nav.then(() => {
      setTimeout(() => window.dispatchEvent(new CustomEvent("cadence:focus-prompt")), 100);
    });
  });
  return () => {
    void unlisten.then((fn) => fn()).catch(() => {});
  };
}

function lookupProjectPath(queryClient: QueryClient, projectId: number): string {
  for (const [, data] of queryClient.getQueriesData<Project[]>({
    queryKey: getListProjectsQueryKey(),
  })) {
    const project = data?.find((p) => p.id === projectId);
    if (project) return project.path;
  }
  return "";
}
