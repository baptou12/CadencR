import { defineCollection, z } from "astro:content";

const news = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    summary: z.string(),
    author: z.string().default("Cadence"),
    tags: z.array(z.string()).default([]),
  }),
});

const roadmap = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.date(),
    status: z.enum(["done", "in-progress", "planned"]),
    category: z.string(),
    order: z.number().default(0),
  }),
});

export const collections = { news, roadmap };
