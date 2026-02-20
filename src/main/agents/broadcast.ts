/**
 * Centralized broadcasting to all renderer windows.
 * Replaces duplicated BrowserWindow.getAllWindows() iteration
 * across subprocess-manager, ipc-bridge, unified-agent, and execute-agent.
 */

export const AGENT_EVENT_CHANNEL = "agent:event";
export const ASK_USER_QUESTION_CHANNEL = "agent:ask-user-question";
export const ASK_USER_ANSWER_CHANNEL = "agent:ask-user-answer";
export const TOOL_PERMISSION_CHANNEL = "agent:tool-permission";
export const DB_UPDATED_CHANNEL = "db:updated";

/**
 * Send a message to all non-destroyed renderer windows on the given channel.
 */
export function broadcast(channel: string, payload: unknown): void {
  const { BrowserWindow } = require("electron") as typeof import("electron");
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
