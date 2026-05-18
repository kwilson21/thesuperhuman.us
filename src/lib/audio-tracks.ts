export type AudioRole = 'mix' | 'master' | 'produce' | 'record';
export type AudioService = 'mixing' | 'mastering' | 'production' | 'recording';

export interface AudioTrack {
  slug: string;
  title: string;
  artist: string;
  year: number;
  role: AudioRole[];
  primaryService: AudioService;
  notes: string;
  file: string;
  length: string;
  featured: boolean;
  order: number;
}

export interface ServiceGroup {
  service: AudioService;
  tracks: AudioTrack[];
}

const SERVICE_ORDER: AudioService[] = ['mixing', 'mastering', 'production', 'recording'];

export function groupTracksByService(tracks: AudioTrack[]): ServiceGroup[] {
  return SERVICE_ORDER.map((service) => {
    const matching = tracks
      .filter((t) => t.primaryService === service)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return b.year - a.year;
      });
    return { service, tracks: matching };
  });
}
