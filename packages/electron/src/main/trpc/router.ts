import { router } from "./trpc";
import { projectsRouter } from "./projects";
import { workspaceRouter } from "./workspace";
import { gitRouter } from "./git";
import { usageRouter } from "./usage";
import { terminalRouter } from "./terminal";

export const appRouter = router({
  workspace: workspaceRouter,
  projects: projectsRouter,
  git: gitRouter,
  usage: usageRouter,
  terminal: terminalRouter,
});

export type AppRouter = typeof appRouter;
