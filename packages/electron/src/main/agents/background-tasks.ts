/**
 * In-memory background task tracking for subprocesses.
 * Tracks background Bash and Task agent spawns and their completion status.
 */

import { broadcast, BACKGROUND_TASK_CHANNEL } from "./broadcast";

export interface BackgroundTask {
  id: string;              // shellId (for Bash) or task_id (for Task agent)
  tempId?: string;         // tool_use block id used before real ID is known
  subprocessId: string;    // parent subprocess that spawned this
  kind: 'bash' | 'agent';  // differentiates kill mechanism
  status: 'running' | 'completed' | 'failed' | 'stopped';
  summary?: string;
  command?: string;        // for bash tasks, the command that was run
  outputFile?: string;     // for agent tasks
  spawnedAt: number;
  completedAt?: number;
}

const backgroundTasksBySubprocess = new Map<string, BackgroundTask[]>();

function broadcastTasks(subprocessId: string): void {
  const tasks = backgroundTasksBySubprocess.get(subprocessId) ?? [];
  broadcast(BACKGROUND_TASK_CHANNEL, { subprocessId, tasks });
}

export function addBackgroundTask(subprocessId: string, task: BackgroundTask): void {
  let tasks = backgroundTasksBySubprocess.get(subprocessId);
  if (!tasks) {
    tasks = [];
    backgroundTasksBySubprocess.set(subprocessId, tasks);
  }
  tasks.push(task);
  broadcastTasks(subprocessId);
}

export function updateBackgroundTask(
  subprocessId: string,
  taskId: string,
  update: Partial<BackgroundTask>,
): void {
  const tasks = backgroundTasksBySubprocess.get(subprocessId);
  if (!tasks) return;
  // Match by id OR tempId
  const task = tasks.find((t) => t.id === taskId || t.tempId === taskId);
  if (!task) return;
  Object.assign(task, update);
  broadcastTasks(subprocessId);
}

export function getBackgroundTasks(subprocessId: string): BackgroundTask[] {
  return backgroundTasksBySubprocess.get(subprocessId) ?? [];
}

export function clearBackgroundTasks(subprocessId: string): void {
  backgroundTasksBySubprocess.delete(subprocessId);
}
