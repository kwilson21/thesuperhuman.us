import { z } from 'astro/zod';

export const musicId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
const visibility = z.enum(['draft', 'public']);
const asset = z.object({
  key: z.string().regex(/^music\/[a-z0-9-]+\/[a-z0-9-]+\.(mp3|mp4)$/),
  type: z.enum(['audio/mpeg', 'video/mp4']),
});
export const recordingSchema = z.object({
  id: musicId, title: z.string().min(1), artist: z.string().min(1), duration: z.number().positive(), visibility,
  credits: z.array(z.object({ role: z.string(), name: z.string() })), lyrics: z.string().optional(),
  versions: z.object({ master: asset, mix: asset.optional(), unmixed: asset.optional(), video: asset.optional() }),
  youtubeId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/).optional(),
});
export const releaseSchema = z.object({
  id: musicId, slug: musicId, title: z.string().min(1), artist: z.string().min(1),
  displayTitle: z.string().optional(), producer: z.string().optional(),
  hero: musicId.optional(), heroQuote: z.string().optional(), lyricQuote: z.string().optional(),
  type: z.enum(['single', 'ep', 'album']), status: z.enum(['preview', 'released']), visibility,
  artwork: z.string().regex(/^\/music\/[a-z0-9-]+\.webp$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), tracks: z.array(musicId).min(1),
});
export const exampleSchema = z.object({
  id: musicId, recordingId: musicId, visibility,
  service: z.enum(['mixing', 'mastering']), summary: z.string().min(1),
  before: z.enum(['unmixed', 'mix']), after: z.enum(['mix', 'master']),
  comparisonNote: z.string().optional(),
});
export type Recording = z.infer<typeof recordingSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type MusicCatalog = { recordings: Recording[]; releases: Release[]; examples: z.infer<typeof exampleSchema>[] };

export function validateCatalog(input: unknown): MusicCatalog {
  const catalog = z.object({ recordings: z.array(recordingSchema), releases: z.array(releaseSchema), examples: z.array(exampleSchema) }).parse(input);
  function unique(values: string[], label: string) {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
  }
  unique(catalog.recordings.map(r => r.id), 'recording ID');
  unique(catalog.releases.map(r => r.id), 'release ID');
  unique(catalog.releases.map(r => r.slug), 'release slug');
  unique(catalog.examples.map(r => r.id), 'example ID');
  const recordings = new Map(catalog.recordings.map(r => [r.id, r]));
  for (const release of catalog.releases) {
    for (const id of release.tracks) {
      const track = recordings.get(id);
      if (!track) throw new Error(`Unknown recording ${id}`);
      if (release.visibility === 'public' && track.visibility !== 'public') throw new Error(`Public release references draft recording ${id}`);
    }
  }
  for (const example of catalog.examples) {
    const track = recordings.get(example.recordingId);
    if (!track || !track.versions[example.before] || !track.versions[example.after]) throw new Error(`Missing comparison recording/version ${example.id}`);
    if (example.visibility === 'public' && track.visibility !== 'public') throw new Error('Public example references draft recording');
  }
  return catalog;
}

export function visibleCatalog(catalog: MusicCatalog, preview: boolean): MusicCatalog {
  const visible = (r: { visibility: string }) => preview || r.visibility === 'public';
  return { recordings: catalog.recordings.filter(visible), releases: catalog.releases.filter(visible), examples: catalog.examples.filter(visible) };
}
export function musicFile(id: string, version: keyof Recording['versions']) { return `/music/file/${id}/${version}`; }
