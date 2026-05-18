import { describe, it, expect } from 'vitest';
import { groupTracksByService, type AudioTrack } from '~/lib/audio-tracks';

const sample: AudioTrack[] = [
  { slug: 'a', title: 'A', artist: 'X', year: 2024, role: ['mix'], primaryService: 'mixing', notes: 'n', file: 'tracks/a.mp3', length: '3:00', featured: false, order: 10 },
  { slug: 'b', title: 'B', artist: 'Y', year: 2024, role: ['master'], primaryService: 'mastering', notes: 'n', file: 'tracks/b.mp3', length: '3:00', featured: false, order: 10 },
  { slug: 'c', title: 'C', artist: 'X', year: 2023, role: ['mix'], primaryService: 'mixing', notes: 'n', file: 'tracks/c.mp3', length: '3:00', featured: false, order: 5 },
];

describe('groupTracksByService', () => {
  it('returns one entry per service in fixed order', () => {
    const groups = groupTracksByService(sample);
    expect(groups.map(g => g.service)).toEqual(['mixing', 'mastering', 'production', 'recording']);
  });

  it('places tracks under their primaryService only', () => {
    const groups = groupTracksByService(sample);
    expect(groups.find(g => g.service === 'mixing')?.tracks.map(t => t.slug)).toEqual(['c', 'a']);
    expect(groups.find(g => g.service === 'mastering')?.tracks.map(t => t.slug)).toEqual(['b']);
    expect(groups.find(g => g.service === 'production')?.tracks).toEqual([]);
    expect(groups.find(g => g.service === 'recording')?.tracks).toEqual([]);
  });

  it('sorts tracks within a service by order ascending then year descending', () => {
    const groups = groupTracksByService(sample);
    const mixing = groups.find(g => g.service === 'mixing')!;
    expect(mixing.tracks.map(t => t.slug)).toEqual(['c', 'a']);
  });
});
