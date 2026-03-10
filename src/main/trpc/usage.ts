import { Effect } from "effect";
import { router, publicProcedure } from "./trpc";
import { AppRuntime } from "../effect/runtime";
import { UsageService } from "../effect/services/UsageService";

export const usageRouter = router({
  getUsage: publicProcedure.query(async () => {
    return await AppRuntime.runPromise(
      Effect.flatMap(UsageService, (s) => s.getUsage()),
    );
  }),
});
