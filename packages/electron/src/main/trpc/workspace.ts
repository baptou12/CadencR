import { router, publicProcedure } from "./trpc";

import { fetchAvailableModels } from "../agents/available-models";

export const workspaceRouter = router({
  /** Get available models from Claude CLI (cached after first call) */
  getAvailableModels: publicProcedure.query(async () => {
    return await fetchAvailableModels();
  }),
});
