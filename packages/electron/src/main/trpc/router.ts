import { router } from "./trpc";
import { projectsRouter } from "./projects";
import { terminalRouter } from "./terminal";

export const appRouter = router({
  projects: projectsRouter,
  terminal: terminalRouter,
});

export type AppRouter = typeof appRouter;
