import { describe, expect, it } from 'vitest';
import { getAudioContextConstructor } from '../../src/scripts/comparison-player';

describe('getAudioContextConstructor', () => {
  it('uses the prefixed Web Audio constructor exposed by mobile Safari', () => {
    const MobileSafariAudioContext = class {} as unknown as typeof AudioContext;

    expect(getAudioContextConstructor({ webkitAudioContext: MobileSafariAudioContext })).toBe(MobileSafariAudioContext);
  });
});
