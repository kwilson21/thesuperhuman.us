import { z } from 'astro/zod';

export const musicId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
export const methodologySchema = z.enum(['two-track-vocals', 'full-mix', 'mastering']);
export const methodologies = {
  'two-track-vocals': { label: 'Two-track vocal mixing', description: 'Vocals mixed over an already mixed instrumental.', service: 'mixing' },
  'full-mix': { label: 'Full mixing', description: 'Individual beat tracks and vocals shaped into a complete mix.', service: 'mixing' },
  mastering: { label: 'Mastering', description: 'A finished mix prepared for release.', service: 'mastering' },
} as const;
const visibility = z.enum(['draft', 'public']);
const audioAsset = z.object({
  key: z.string().regex(/^music\/[a-z0-9-]+\/[a-z0-9-]+\.mp3$/),
  type: z.literal('audio/mpeg'),
});
const videoAsset = z.object({
  key: z.string().regex(/^music\/[a-z0-9-]+\/[a-z0-9-]+\.mp4$/),
  type: z.literal('video/mp4'),
});
export const recordingSchema = z.object({
  id: musicId, title: z.string().min(1), artist: z.string().min(1), duration: z.number().positive(), visibility,
  credits: z.array(z.object({ role: z.string(), name: z.string() })), lyrics: z.string().optional(),
  services: z.array(methodologySchema).default([]),
  versions: z.object({ master: audioAsset.optional(), mix: audioAsset.optional(), unmixed: audioAsset.optional(), video: videoAsset.optional() }).refine(v => v.master || v.mix || v.unmixed, { message: 'At least one audio export is required' }),
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
  service: z.enum(['mixing', 'mastering']), methodology: methodologySchema.optional(), summary: z.string().min(1),
  before: z.enum(['unmixed', 'mix']), after: z.enum(['mix', 'master']),
  comparisonNote: z.string().optional(),
  alignment: z.object({ before: z.number().min(0).default(0), after: z.number().min(0).default(0) }).default({ before: 0, after: 0 }),
  loudness: z.object({ before: z.number().min(-100).max(0), after: z.number().min(-100).max(0) }).optional(),
  waveforms: z.object({ before: z.array(z.number().min(0).max(1)).min(1).max(400), after: z.array(z.number().min(0).max(1)).min(1).max(400) }).optional(),
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
      if (!track.versions.master && !track.versions.mix) throw new Error(`Release needs a playable mix or master: ${id}`);
      if (release.visibility === 'public' && track.visibility !== 'public') throw new Error(`Public release references draft recording ${id}`);
    }
  }
  for (const example of catalog.examples) {
    const track = recordings.get(example.recordingId);
    if (example.methodology && methodologies[example.methodology].service !== example.service) throw new Error(`Incompatible methodology and service: ${example.id}`);
    if (example.service === 'mixing' && !example.methodology) throw new Error(`Mixing methodology is required: ${example.id}`);
    if (example.service === 'mastering' ? example.before !== 'mix' || example.after !== 'master' : example.before !== 'unmixed' || example.after !== 'mix') throw new Error(`Invalid comparison pair: ${example.id}`);
    if (example.methodology && track?.services.length && !track.services.includes(example.methodology)) throw new Error(`Comparison methodology is not credited: ${example.id}`);
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

export function releaseVersion(recording: Recording): 'master' | 'mix' { return recording.versions.master ? 'master' : 'mix'; }
