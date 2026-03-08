import { z } from "zod";
import fs from "node:fs";
import { router, publicProcedure } from "./trpc";

import { getDatabase } from "../db/database";
import type { SettingRow } from "../db/types";
import { discoverClaudeCli } from "../agents/cli-discovery";
import { DEFAULT_MODEL } from "../agents/models";
import type { AgentType } from "../agents/types";
import { fetchAvailableModels } from "../agents/available-models";

export const workspaceRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(input.key) as
      | SettingRow
      | undefined;
    return row?.value ?? null;
  }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(input.key, input.value);
      return { success: true };
    }),

  list: publicProcedure.query(() => {
    const db = getDatabase();
    const rows = db.prepare("SELECT key, value FROM settings").all() as SettingRow[];
    return rows;
  }),

  /** Get the current Claude CLI path (from settings or auto-discovered) */
  getClaudeCliPath: publicProcedure.query(async () => {
    const cliInfo = await discoverClaudeCli();
    return cliInfo ? { path: cliInfo.path, source: cliInfo.source } : null;
  }),

  /** Get model settings for all agent types from global settings */
  getModelSettings: publicProcedure.query(() => {
    const db = getDatabase();
    const agentTypes = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
    const result: Record<string, string> = {};
    for (const at of agentTypes) {
      const row = db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .get(`model_${at}`) as SettingRow | undefined;
      result[at] = row?.value ?? DEFAULT_MODEL;
    }
    return result as Record<AgentType, string>;
  }),

  /** Set a model for a specific agent type in global settings */
  setModelSetting: publicProcedure
    .input(
      z.object({
        agentType: z.enum(["plan", "prd", "execute", "risk", "review", "session", "qa", "review-fixer", "retro"]),
        modelId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase();
      const key = `model_${input.agentType}`;
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, input.modelId);
      return { success: true };
    }),

  /** Get available models from Claude CLI (cached after first call) */
  getAvailableModels: publicProcedure.query(async () => {
    return await fetchAvailableModels();
  }),

  /** Set a custom Claude CLI path (validates the file exists) */
  setClaudeCliPath: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(async ({ input }) => {
      try {
        await fs.promises.access(input.path);
      } catch {
        throw new Error(`File not found: ${input.path}`);
      }
      const db = getDatabase();
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run("claude_cli_path", input.path);
      return { success: true, path: input.path };
    }),

  /** Get the last 100 prompt history entries for a project (most recent first) */
  getPromptHistory: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const db = getDatabase();
      const rows = db
        .prepare(
          "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
        )
        .all(input.projectId) as Array<{ content: string }>;
      return rows.map((r) => r.content);
    }),

  /** Add a new entry to the prompt history for a project (with dedup and 100-entry cap) */
  addPromptEntry: publicProcedure
    .input(z.object({ projectId: z.number(), content: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase();

      // Dedup: skip if the most recent entry has the same content
      const latest = db
        .prepare(
          "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
        )
        .get(input.projectId) as { content: string } | undefined;

      if (latest?.content === input.content) {
        return { success: true, skipped: true };
      }

      // Insert new entry
      db.prepare(
        "INSERT INTO prompt_history (project_id, content) VALUES (?, ?)",
      ).run(input.projectId, input.content);

      // Trim to 100 entries: delete everything beyond the newest 100
      db.prepare(
        "DELETE FROM prompt_history WHERE project_id = ? AND id NOT IN (SELECT id FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100)",
      ).run(input.projectId, input.projectId);

      return { success: true, skipped: false };
    }),
});
