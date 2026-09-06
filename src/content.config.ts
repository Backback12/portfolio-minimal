import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projectsCollection = defineCollection({
  loader: glob({
    pattern: '**/*.{mdx,md}',
    base: './src/content/projects',
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.string(),
      sortDate: z.string().optional(),
      order: z.number().optional(),
      image: image().optional(),
    }),
});

const blogCollection = defineCollection({
  loader: glob({
    pattern: '**/*.{mdx,md}',
    base: './src/content/blog',
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      description: z.string(),
      image: image().optional(),
    }),
});

export const collections = {
  projects: projectsCollection,
  blog: blogCollection,
};