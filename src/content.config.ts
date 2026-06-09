import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projectsCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    date: z.string(), // This is the display date (e.g. "Spring 2026")
    sortDate: z.string().optional(), // E.g. "2026-04" for exact sorting
    order: z.number().optional(), // 1, 2, 3...
    image: z.string().optional(),
  }),
});

const blogCollection = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    date: z.string(),
    description: z.string(),
  }),
});

export const collections = {
  projects: projectsCollection,
  blog: blogCollection,
};