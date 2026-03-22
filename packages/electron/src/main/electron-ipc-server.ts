/**
 * Minimal HTTP server that the Rust backend can call for IPC operations.
 */

import http from "node:http";

const DEFAULT_ELECTRON_IPC_PORT = 45679;

let server: http.Server | null = null;

export async function startElectronIpcServer(
  port: number = DEFAULT_ELECTRON_IPC_PORT,
): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
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
