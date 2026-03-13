import { z } from "zod";
import fs from "node:fs";
import { Effect, Option } from "effect";
import { router, publicProcedure } from "./trpc";

import { queryOne, queryAll, execute } from "../db/query";
import type { SettingRow } from "../db/types";
import { discoverClaudeCli } from "../agents/cli-discovery";
import { DEFAULT_MODEL } from "../agents/models";
import type { AgentType } from "../agents/types";
import { fetchAvailableModels } from "../agents/available-models";
import { AppRuntime } from "../effect/runtime";

export const workspaceRouter = router({
  get: publicProcedure.input(z.object({ key: z.string() })).query(async ({ input }) => {
    const row = await AppRuntime.runPromise(queryOne<SettingRow>(
      "SELECT value FROM settings WHERE key = ?",
      input.key,
    ));
    return row?.value ?? null;
  }),

  set: publicProcedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(async ({ input }) => {
      await AppRuntime.runPromise(execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        input.key, input.value,
      ));
      return { success: true };
    }),

  list: publicProcedure.query(async () => {
    return await AppRuntime.runPromise(queryAll<SettingRow>(
      "SELECT key, value FROM settings",
    ));
  }),

  /** Get the current Claude CLI path (from settings or auto-discovered) */
  getClaudeCliPath: publicProcedure.query(async () => {
    const cliInfoOpt = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));
    return Option.isSome(cliInfoOpt)
      ? { path: cliInfoOpt.value.path, source: cliInfoOpt.value.source }
      : null;
  }),

  /** Get model settings for all agent types from global settings */
  getModelSettings: publicProcedure.query(async () => {
    const agentTypes = ["plan", "prd", "execute", "risk", "review", "review-fixer", "session", "qa", "retro"] as const;
    const result: Record<string, string> = {};
    for (const at of agentTypes) {
      const row = await AppRuntime.runPromise(queryOne<SettingRow>(
        "SELECT value FROM settings WHERE key = ?",
        `model_${at}`,
      ));
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
    .mutation(async ({ input }) => {
      const key = `model_${input.agentType}`;
      await AppRuntime.runPromise(execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key, input.modelId,
      ));
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
      await AppRuntime.runPromise(execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        "claude_cli_path", input.path,
      ));
      return { success: true, path: input.path };
    }),

  /** Get the last 100 prompt history entries for a project (most recent first) */
  getPromptHistory: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const rows = await AppRuntime.runPromise(queryAll<{ content: string }>(
        "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100",
        input.projectId,
      ));
      return rows.map((r) => r.content);
    }),

  /** Add a new entry to the prompt history for a project (with dedup and 100-entry cap) */
  addPromptEntry: publicProcedure
    .input(z.object({ projectId: z.number(), content: z.string() }))
    .mutation(async ({ input }) => {
      // Dedup: skip if the most recent entry has the same content
      const latest = await AppRuntime.runPromise(queryOne<{ content: string }>(
        "SELECT content FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
        input.projectId,
      ));

      if (latest?.content === input.content) {
        return { success: true, skipped: true };
      }

      // Insert new entry
      await AppRuntime.runPromise(execute(
        "INSERT INTO prompt_history (project_id, content) VALUES (?, ?)",
        input.projectId, input.content,
      ));

      // Trim to 100 entries: delete everything beyond the newest 100
      await AppRuntime.runPromise(execute(
        "DELETE FROM prompt_history WHERE project_id = ? AND id NOT IN (SELECT id FROM prompt_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 100)",
        input.projectId, input.projectId,
      ));

      return { success: true, skipped: false };
    }),
});
