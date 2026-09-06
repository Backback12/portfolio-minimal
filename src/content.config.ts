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

const eventsCollection = defineCollection({
  loader: glob({
    pattern: '**/*.mdx',
    base: './src/content/events',
  }),
  schema: ({ image }) =>
    z.object({
      event: z.string(),
      date: z.coerce.date(),
      location: z.string(),
      image: z.string(),
      description: z.string(),
    }),
});

export const collections = {
  projects: projectsCollection,
  blog: blogCollection,
  events: eventsCollection,
};