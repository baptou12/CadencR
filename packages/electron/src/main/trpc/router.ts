import { z } from "zod";
import { router, publicProcedure } from "./trpc";
import { projectsRouter } from "./projects";
import { workspaceRouter } from "./workspace";
import { agentsRouter } from "./agents";
import { sessionsRouter } from "./sessions";
import { gitRouter } from "./git";
import { usageRouter } from "./usage";
import { terminalRouter } from "./terminal";

export const appRouter = router({
  hello: publicProcedure.input(z.object({ name: z.string().optional() })).query(({ input }) => {
    return { greeting: `Hello, ${input.name ?? "world"}!` };
  }),
  workspace: workspaceRouter,
  projects: projectsRouter,
  agents: agentsRouter,
  sessions: sessionsRouter,
  git: gitRouter,
  usage: usageRouter,
  terminal: terminalRouter,
});

export type AppRouter = typeof appRouter;
