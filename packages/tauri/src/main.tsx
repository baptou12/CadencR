import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { preloadRuntimeConfig } from "./api/client";
import "./index.css";

// Preload port + token before mounting so sync accessors everywhere have
// the config by the time the first request or WebSocket fires.
async function bootstrap(): Promise<void> {
  await preloadRuntimeConfig();
  const root = createRoot(document.getElementById("root")!);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap().catch((err) => {
  console.error("Cadencr bootstrap failed:", err);
  const root = document.getElementById("root");
  if (root) {
    root.textContent = `Failed to start Cadencr: ${err instanceof Error ? err.message : String(err)}`;
  }
});
