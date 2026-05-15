import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const news = defineCollection({
  loader: glob({ base: "./src/content/news", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    summary: z.string(),
    author: z.string().default("Cadencr"),
    tags: z.array(z.string()).default([]),
  }),
});

const roadmap = defineCollection({
  loader: glob({ base: "./src/content/roadmap", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string(),
    date: z.date(),
    status: z.enum(["done", "in-progress", "planned"]),
    category: z.string(),
    order: z.number().default(0),
  }),
});

export const collections = { news, roadmap };
