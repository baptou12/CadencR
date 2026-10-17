import { z } from "zod";

/** Signed distribution metadata; the archive contains the runtime's tab.json. */
export const tabPackageSchema = z
  .object({
    tab: z
      .object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        version: z.string(),
        repository: z.string(),
        license: z.string(),
        api_version: z.literal(1),
        distribution: z
          .object({
            repository: z.string().optional(),
            archive: z.string().url(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      })
      .strict(),
    host: z
      .object({
        publisher: z.string(),
        compatibility: z
          .object({ min_app_version: z.string(), max_app_version: z.string().optional() })
          .strict(),
        assets: z
          .object({
            icon: z.string(),
            readme: z.string().optional(),
            license: z.string().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type TabMarketplacePackage = z.infer<typeof tabPackageSchema>;
