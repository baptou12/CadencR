import path from "node:path";
import { dialog } from "electron";
import { router, publicProcedure } from "./trpc";

export const projectsRouter = router({
  selectFolder: publicProcedure.mutation(async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    const name = path.basename(folderPath);
    return { name, path: folderPath };
  }),
});
