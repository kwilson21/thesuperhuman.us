import type { AudioService } from '~/lib/audio-tracks';

export const audioServices: Record<AudioService, { label: string; description: string }> = {
  mixing: { label: 'Mixing', description: 'I balance and shape the recorded parts so they work together as a song.' },
  mastering: { label: 'Mastering', description: 'I adjust the overall tone, dynamics and level of a finished mix for release.' },
  production: { label: 'Production', description: 'I help develop the arrangement and shape the track.' },
  recording: { label: 'Recording', description: 'I guide you through recording remotely and help prepare the takes.' },
};
