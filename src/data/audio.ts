import type { AudioService } from '~/lib/audio-tracks';

export const audioServices: Record<AudioService, { label: string; description: string }> = {
  mixing: { label: 'Mixing', description: 'Bring the recorded parts into a coherent mix.' },
  mastering: { label: 'Mastering', description: 'Refine a finished mix for release.' },
  production: { label: 'Production', description: 'Develop the arrangement and shape of a track.' },
  recording: { label: 'Recording', description: 'Guide remote recording and prepare the takes.' },
};
