import { useEffect, useState } from "react";
import { trpc } from "@/trpc";
import type { BackgroundTask } from "../../main/agents/background-tasks";

interface BackgroundTasksPayload {
  subprocessId: string;
  tasks: BackgroundTask[];
}

export function useBackgroundTasks(subprocessId?: string) {
  const { data: initialTasks = [] } = trpc.agents.getBackgroundTasks.useQuery(
    { subprocessId: subprocessId! },
    { enabled: !!subprocessId },
  );

  const [tasks, setTasks] = useState<BackgroundTask[]>([]);

  // Sync initial data from query
  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  // Listen for real-time IPC updates
  useEffect(() => {
    if (!subprocessId) return;

    const api = (
      window as unknown as {
        api?: {
          onBackgroundTasks: (cb: (data: unknown) => void) => unknown;
          offBackgroundTasks: (listener?: unknown) => void;
        };
      }
    ).api;
    if (!api) return;

    const listener = api.onBackgroundTasks((data: unknown) => {
      const payload = data as BackgroundTasksPayload;
      if (payload.subprocessId === subprocessId) {
        setTasks(payload.tasks);
      }
    });

    return () => {
      api.offBackgroundTasks(listener as undefined);
    };
  }, [subprocessId]);

  const activeCount = tasks.filter((t) => t.status === "running").length;

  return { tasks, activeCount };
}
