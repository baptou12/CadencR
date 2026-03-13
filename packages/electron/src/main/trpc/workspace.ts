import { z } from "zod";
import fs from "node:fs";
import { Effect, Option } from "effect";
import { router, publicProcedure } from "./trpc";

import { execute } from "../db/query";
import { discoverClaudeCli } from "../agents/cli-discovery";
import { fetchAvailableModels } from "../agents/available-models";
import { AppRuntime } from "../effect/runtime";

export const workspaceRouter = router({
  /** Get the current Claude CLI path (from settings or auto-discovered) */
  getClaudeCliPath: publicProcedure.query(async () => {
    const cliInfoOpt = await Effect.runPromise(discoverClaudeCli().pipe(Effect.option));
    return Option.isSome(cliInfoOpt)
      ? { path: cliInfoOpt.value.path, source: cliInfoOpt.value.source }
      : null;
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
});
