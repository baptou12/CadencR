/**
 * BackgroundTaskRegistry Effect Service
 *
 * In-memory registry for tracking background Bash and Task agent spawns
 * and their completion status, replacing module-level mutable state in
 * background-tasks.ts.
 */

import { Context, Effect, Layer } from "effect";
import { BrowserWindow } from "electron";
import type { BackgroundTask } from "../../agents/background-tasks.js";

export const BACKGROUND_TASK_CHANNEL = "agent:background-tasks";

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface BackgroundTaskRegistryService {
  /** Add a background task for a subprocess. */
  add: (task: BackgroundTask) => Effect.Effect<void>;

  /** Update a background task identified by taskIdOrTempId. */
  update: (
    subprocessId: string,
    taskIdOrTempId: string,
    patch: Partial<BackgroundTask>,
  ) => Effect.Effect<void>;

  /** Get all background tasks for a subprocess. */
  getBySubprocess: (subprocessId: string) => Effect.Effect<BackgroundTask[]>;

  /** Clear all background tasks for a subprocess. */
  clear: (subprocessId: string) => Effect.Effect<void>;

  /** Broadcast current tasks for a subprocess to all renderer windows. */
  broadcast: (subprocessId: string) => Effect.Effect<void>;
}

/** Context tag for the BackgroundTaskRegistry service */
export class BackgroundTaskRegistry extends Context.Tag("BackgroundTaskRegistry")<
  BackgroundTaskRegistry,
  BackgroundTaskRegistryService
>() {}

// ---------------------------------------------------------------------------
// Live implementation
// ---------------------------------------------------------------------------

export const BackgroundTaskRegistryLive = Layer.sync(BackgroundTaskRegistry, () => {
  const tasksBySubprocess = new Map<string, BackgroundTask[]>();

  function broadcastTasks(subprocessId: string): void {
    const tasks = tasksBySubprocess.get(subprocessId) ?? [];
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(BACKGROUND_TASK_CHANNEL, { subprocessId, tasks });
      }
    }
  }

  return {
    add: (task: BackgroundTask) =>
      Effect.sync(() => {
        let tasks = tasksBySubprocess.get(task.subprocessId);
        if (!tasks) {
          tasks = [];
          tasksBySubprocess.set(task.subprocessId, tasks);
        }
        tasks.push(task);
        broadcastTasks(task.subprocessId);
      }),

    update: (subprocessId: string, taskIdOrTempId: string, patch: Partial<BackgroundTask>) =>
      Effect.sync(() => {
        const tasks = tasksBySubprocess.get(subprocessId);
        if (!tasks) return;
        const task = tasks.find((t) => t.id === taskIdOrTempId || t.tempId === taskIdOrTempId);
        if (!task) return;
        Object.assign(task, patch);
        broadcastTasks(subprocessId);
      }),

    getBySubprocess: (subprocessId: string) =>
      Effect.sync(() => tasksBySubprocess.get(subprocessId) ?? []),

    clear: (subprocessId: string) =>
      Effect.sync(() => {
        tasksBySubprocess.delete(subprocessId);
      }),

    broadcast: (subprocessId: string) =>
      Effect.sync(() => {
        broadcastTasks(subprocessId);
      }),
  };
});
