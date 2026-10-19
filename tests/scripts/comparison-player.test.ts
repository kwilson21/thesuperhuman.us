import { describe, expect, it } from 'vitest';
import { getAudioContextConstructor, isWaveformScrub, setPlaybackAudioSession, waveformGeometry, waveformSeekSeconds } from '../../src/scripts/comparison-player';
import { TOUCH_SCRUB_MIN_DISTANCE } from '../../src/lib/waveform';

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

describe('waveformGeometry', () => {
  it('maps the selected export amplitudes onto one centered waveform', () => {
    expect(waveformGeometry([0, 0.5, 1])).toEqual([
      { y1: 31, y2: 33 },
      { y1: 17, y2: 47 },
      { y1: 2, y2: 62 },
    ]);
  });
});

describe('waveformSeekSeconds', () => {
  it('maps a click at the middle of the waveform to the middle of the track', () => {
    expect(waveformSeekSeconds(200, 100, 200, 300)).toBe(150);
  });

  it('maps a click at the left edge to the start of the track', () => {
    expect(waveformSeekSeconds(100, 100, 200, 300)).toBe(0);
  });

  it('returns 0 when the waveform has no width', () => {
    expect(waveformSeekSeconds(200, 100, 0, 300)).toBe(0);
  });

  it('clamps a drag past the left edge to the start of the track', () => {
    expect(waveformSeekSeconds(50, 100, 200, 300)).toBe(0);
  });

  it('clamps a drag past the right edge to the end of the track', () => {
    expect(waveformSeekSeconds(400, 100, 200, 300)).toBe(300);
  });
});

describe('isWaveformScrub', () => {
  it('scrubs with a mouse or pen whatever the direction of movement', () => {
    expect(isWaveformScrub('mouse', 0, 50)).toBe(true);
    expect(isWaveformScrub('pen', 2, 40)).toBe(true);
    expect(isWaveformScrub('mouse', 0, 0)).toBe(true);
    expect(isWaveformScrub('pen', 0, 0)).toBe(true);
  });

  it('scrubs a touch only when it moves more sideways than vertically', () => {
    expect(isWaveformScrub('touch', 10, 3)).toBe(true);
    expect(isWaveformScrub('touch', 3, 10)).toBe(false);
    expect(isWaveformScrub('touch', 0, 0)).toBe(false);
  });

  it('ignores contact jitter so a touch scrubs only after a clear sideways move', () => {
    expect(isWaveformScrub('touch', 2, 1)).toBe(false);
    expect(isWaveformScrub('touch', TOUCH_SCRUB_MIN_DISTANCE - 1, 0)).toBe(false);
    expect(isWaveformScrub('touch', TOUCH_SCRUB_MIN_DISTANCE, 0)).toBe(true);
    expect(isWaveformScrub('touch', 12, 3)).toBe(true);
    expect(isWaveformScrub('touch', 3, 12)).toBe(false);
  });
});
