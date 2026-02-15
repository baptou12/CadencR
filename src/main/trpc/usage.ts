import { router, publicProcedure } from "./trpc";
import { getUsage } from "../usage/usage-service";

export const usageRouter = router({
  getUsage: publicProcedure.query(async () => {
    return await getUsage();
  }),
});
