import { router } from "./trpc";
import { projectsRouter } from "./projects";
import { workspaceRouter } from "./workspace";
import { usageRouter } from "./usage";
import { terminalRouter } from "./terminal";

export const appRouter = router({
  workspace: workspaceRouter,
  projects: projectsRouter,
  usage: usageRouter,
  terminal: terminalRouter,
});

export type AppRouter = typeof appRouter;
