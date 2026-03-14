/**
 * Minimal HTTP server that the Rust backend can call for IPC operations.
 * Currently supports:
 *   POST /stop-agents/:featureId — stop any running agent subprocesses for a feature
 */

import http from "node:http";
import { AppRuntime } from "./effect/runtime";
import { queryAll } from "./db/query";
import { getSubprocessIdsForSessionDbIds } from "./agents/effect-helpers";
import { stopSubprocess } from "./agents/subprocess-manager";

const DEFAULT_ELECTRON_IPC_PORT = 45679;

let server: http.Server | null = null;

export async function startElectronIpcServer(
  port: number = DEFAULT_ELECTRON_IPC_PORT,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer(async (req, res) => {
      const url = req.url ?? "";
      const match = /^\/stop-agents\/(\d+)$/.exec(url);

      if (req.method === "POST" && match) {
        const featureId = Number(match[1]);
        try {
          const sessionIds = await AppRuntime.runPromise(
            queryAll<{ id: number }>(
              "SELECT id FROM agent_sessions WHERE feature_id = ? AND status IN ('running', 'paused')",
              featureId,
            ),
          );
          if (sessionIds.length > 0) {
            const subprocessIds = getSubprocessIdsForSessionDbIds(
              sessionIds.map((s) => s.id),
            );
            for (const spId of subprocessIds) {
              try {
                await stopSubprocess(spId);
              } catch {
                // best effort
              }
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          console.error("[electron-ipc-server] Error stopping agents:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: String(err) }));
        }
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      }
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`[electron-ipc-server] Listening on port ${port}`);
      resolve();
    });
  });
}

export function stopElectronIpcServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
