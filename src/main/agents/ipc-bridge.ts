import { BrowserWindow } from "electron";
import type { ManagedSubprocess } from "./subprocess-manager";
import type { AgentEvent, AgentType, StreamEvent } from "./types";
import { getDatabase } from "../db/database";

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
  sessionDbId?: number,
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

      // Capture Claude session ID from system events
      if (sessionDbId && event.type === "system" && event.session_id) {
        try {
          const db = getDatabase();
          db.prepare(
            "UPDATE agent_sessions SET claude_session_id = ? WHERE id = ?",
          ).run(event.session_id, sessionDbId);
        } catch {
          // Best-effort persistence
        }
      }

      // Persist messages to agent_messages table
      if (sessionDbId) {
        persistStreamEvent(sessionDbId, event);
      }

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

/**
 * Persist a stream event to the agent_messages table.
 * Only persists content-bearing events (text, tool calls, tool results, errors).
 */
function persistStreamEvent(sessionDbId: number, event: StreamEvent): void {
  try {
    const db = getDatabase();
    const insert = db.prepare(
      "INSERT INTO agent_messages (session_id, role, content, message_type, tool_name) VALUES (?, ?, ?, ?, ?)",
    );

    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "text" && event.content_block.text) {
          insert.run(sessionDbId, "assistant", event.content_block.text, "text", null);
        } else if (event.content_block.type === "tool_use") {
          insert.run(
            sessionDbId,
            "assistant",
            JSON.stringify(event.content_block.input),
            "tool_call",
            event.content_block.name,
          );
        }
        break;
      }
      case "content_block_delta": {
        if (event.delta.type === "text_delta" && event.delta.text) {
          insert.run(sessionDbId, "assistant", event.delta.text, "text_delta", null);
        }
        break;
      }
      case "tool_result": {
        insert.run(
          sessionDbId,
          "tool",
          event.content,
          event.is_error ? "tool_error" : "tool_result",
          null,
        );
        break;
      }
      case "error": {
        insert.run(sessionDbId, "system", event.error.message, "error", null);
        break;
      }
      default:
        // Skip non-content events (message_start, message_stop, message_delta, system)
        break;
    }
  } catch {
    // Best-effort persistence — don't crash the bridge
  }
}

export { AGENT_EVENT_CHANNEL };
