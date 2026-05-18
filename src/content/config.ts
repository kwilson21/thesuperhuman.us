import { defineCollection, z } from 'astro:content';

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

const notes = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const audioTracks = defineCollection({
  type: 'data',
  schema: z.object({
    title: z.string().min(1),
    artist: z.string().min(1),
    year: z.number().int().min(1900).max(2100),
    role: z.array(z.enum(['mix', 'master', 'produce', 'record'])).min(1),
    primaryService: z.enum(['mixing', 'mastering', 'production', 'recording']),
    notes: z.string().min(1),
    file: z.string().regex(/^tracks\/[a-z0-9-]+\.mp3$/),
    length: z.string().regex(/^\d{1,2}:\d{2}$/),
    featured: z.boolean().default(false),
    order: z.number().int().default(100),
  }),
});

export const collections = { pages, notes, 'audio-tracks': audioTracks };
