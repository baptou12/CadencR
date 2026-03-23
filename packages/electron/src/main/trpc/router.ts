import { router } from "./trpc";
import { projectsRouter } from "./projects";
import { usageRouter } from "./usage";
import { terminalRouter } from "./terminal";

export const appRouter = router({
  projects: projectsRouter,
  usage: usageRouter,
  terminal: terminalRouter,
});

export type AppRouter = typeof appRouter;
