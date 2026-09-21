import { describe, expect, it } from 'vitest';
import { getAudioContextConstructor, setPlaybackAudioSession } from '../../src/scripts/comparison-player';

describe('getAudioContextConstructor', () => {
  it('uses the prefixed Web Audio constructor exposed by mobile Safari', () => {
    const MobileSafariAudioContext = class {} as unknown as typeof AudioContext;

    expect(getAudioContextConstructor({ webkitAudioContext: MobileSafariAudioContext })).toBe(MobileSafariAudioContext);
  });
});

describe('setPlaybackAudioSession', () => {
  it('uses the media playback session when the browser exposes one', () => {
    const audioSession = { type: 'ambient' };

    expect(setPlaybackAudioSession({ audioSession })).toBe(true);
    expect(audioSession.type).toBe('playback');
  });

  it('leaves browsers without the Audio Session API unchanged', () => {
    expect(setPlaybackAudioSession({})).toBe(false);
  });
});
