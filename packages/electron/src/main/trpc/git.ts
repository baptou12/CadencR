import { z } from "zod";
import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import {
  openInTerminalEffect,
  openInZedEffect,
} from "../effect/services/GitWorktree";
import { AppRuntime } from "../effect/runtime";
import { resolveFeatureGitPath } from "./shared";

export const gitRouter = router({
  /** Open a worktree/project path in the system terminal */
  openInTerminal: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return yield* Effect.fail(new Error("No working directory found for this feature"));
          yield* openInTerminalEffect(gitPath);
          return { success: true };
        }),
      );
    }),

  /** Open a worktree/project path in Zed editor */
  openInZed: publicProcedure
    .input(z.object({ featureId: z.number() }))
    .mutation(async ({ input }) => {
      return AppRuntime.runPromise(
        Effect.gen(function* () {
          const gitPath = yield* resolveFeatureGitPath(input.featureId);
          if (!gitPath) return yield* Effect.fail(new Error("No working directory found for this feature"));
          yield* openInZedEffect(gitPath);
          return { success: true };
        }),
      );
    }),
});
