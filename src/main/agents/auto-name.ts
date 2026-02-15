import { BrowserWindow } from "electron";
import { getDatabase } from "../db/database";
import { startSubprocess } from "./subprocess-manager";
import type { StreamEvent } from "./types";

const AUTO_NAME_SYSTEM_PROMPT =
  "Generate a concise feature name (3-7 words) based on the user's description. Output the name wrapped in delimiters exactly like this: __FEATURE_NAME_START__Your Feature Name Here__FEATURE_NAME_END__. Output nothing else.";

const AUTO_NAME_MODEL = "claude-haiku-3-5-20241022";

/**
 * Auto-name a feature using a lightweight Haiku query.
 *
 * This is fire-and-forget — it spawns a subprocess, collects the text output,
 * updates the feature title in the DB, and broadcasts a `db:updated` event so
 * the renderer can invalidate the features query.
 */
export function autoNameFeature(
  featureId: number,
  userInput: string,
  cwd: string,
): void {
  let accumulatedText = "";

  const managed = startSubprocess({
    cwd,
    agentType: "session",
    systemPrompt: AUTO_NAME_SYSTEM_PROMPT,
    prompt: userInput,
    model: AUTO_NAME_MODEL,
    allowedTools: [],
  });

  managed.eventListeners.push((event: StreamEvent) => {
    if (
      event.type === "content_block_start" &&
      event.content_block.type === "text"
    ) {
      accumulatedText += event.content_block.text;
    } else if (
      event.type === "content_block_delta" &&
      "delta" in event &&
      event.delta.type === "text_delta"
    ) {
      accumulatedText += event.delta.text;
    }
  });

  managed.completionListeners.push(() => {
    const match = accumulatedText.match(
      /__FEATURE_NAME_START__(.+?)__FEATURE_NAME_END__/,
    );
    const name = (match ? match[1] : accumulatedText)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!name) return;

    try {
      const db = getDatabase();
      db.prepare("UPDATE features SET title = ? WHERE id = ?").run(
        name,
        featureId,
      );

      // Broadcast db:updated so the renderer invalidates features query
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send("db:updated", {
            entity: "feature",
            featureId,
          });
        }
      }
    } catch (err) {
      console.error("[auto-name] Failed to update feature title:", err);
    }
  });
}
