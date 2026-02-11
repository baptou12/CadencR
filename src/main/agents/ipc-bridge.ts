import { BrowserWindow } from "electron";
import type { ManagedSubprocess } from "./subprocess-manager";
import type { AgentEvent, AgentType, StreamEvent } from "./types";

const AGENT_EVENT_CHANNEL = "agent:event";

/**
 * Parse a line of stream-json output into a typed StreamEvent.
 * Returns null if the line is empty or not valid JSON.
 */
function parseStreamJsonLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as StreamEvent;
  } catch {
    return null;
  }
}

/**
 * Attach stream-json parsing to a managed subprocess and relay events
 * to all renderer windows via webContents.send().
 */
export function bridgeSubprocessToRenderer(
  managed: ManagedSubprocess,
  agentType: AgentType,
): void {
  const { process: child, id } = managed;

  if (!child.stdout) return;

  let buffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");

    // Process complete lines
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseStreamJsonLine(line);
      if (!event) continue;

      const agentEvent: AgentEvent = {
        subprocessId: id,
        agentType,
        event,
        timestamp: Date.now(),
      };

      // Send to all open windows
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(AGENT_EVENT_CHANNEL, agentEvent);
        }
      }
    }
  });

  // Handle stderr as error events
  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (!text) return;

      const agentEvent: AgentEvent = {
        subprocessId: id,
        agentType,
        event: {
          type: "error",
          error: { type: "stderr", message: text },
        },
        timestamp: Date.now(),
      };

      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(AGENT_EVENT_CHANNEL, agentEvent);
        }
      }
    });
  }

  // Flush remaining buffer on close
  child.stdout.on("end", () => {
    if (buffer.trim()) {
      const event = parseStreamJsonLine(buffer);
      if (event) {
        const agentEvent: AgentEvent = {
          subprocessId: id,
          agentType,
          event,
          timestamp: Date.now(),
        };
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send(AGENT_EVENT_CHANNEL, agentEvent);
          }
        }
      }
    }
  });
}

export { AGENT_EVENT_CHANNEL };
