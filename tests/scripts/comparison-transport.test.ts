import { describe, expect, it, vi } from 'vitest';
import { ComparisonTransport } from '../../src/scripts/comparison-transport';

function fixture() {
  const sources: any[] = [], gains: any[] = [];
  const context = {
    currentTime: 10, destination: {},
    createGain() { const node = { gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() }, connect: vi.fn() }; gains.push(node); return node; },
    createBufferSource() { const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; sources.push(source); return source; },
  };
  const transport = new ComparisonTransport(context as any, [{ duration: 160.3 }, { duration: 160 }] as AudioBuffer[], [0.05, 0], 160, vi.fn());
  return { context, sources, gains, transport };
}
describe('shared comparison clock', () => {
  it('starts both exports at exactly the same clock time with their source offsets', () => {
    const { transport, sources } = fixture(); transport.play();
    expect(sources[0].start.mock.calls[0][0]).toBe(sources[1].start.mock.calls[0][0]);
    expect(sources[0].start.mock.calls[0][1]).toBe(.05);
    expect(sources[1].start.mock.calls[0][1]).toBe(0);
  });
  it('rapid A/B and loudness changes never seek, restart or stop either source', () => {
    const { transport, sources, context } = fixture(); transport.play();
    context.currentTime += 1;
    const position = transport.position;
    for (let i = 0; i < 100; i++) transport.setLevels(i % 2 ? [1, 0] : [0, .75]);
    expect(transport.position).toBe(position); expect(sources).toHaveLength(2);
    sources.forEach(s => { expect(s.start).toHaveBeenCalledTimes(1); expect(s.stop).not.toHaveBeenCalled(); });
  });
  it('seeks both exports together and resumes from one position after pausing', () => {
    const { transport, sources, context } = fixture(); transport.play(); transport.seek(70);
    expect(sources[2].start.mock.calls[0][1]).toBe(70.05);
    expect(sources[3].start.mock.calls[0][1]).toBe(70);
    context.currentTime += 2; transport.pause(); const stopped = transport.position;
    context.currentTime += 20; expect(transport.position).toBe(stopped);
    transport.play(); expect(sources[4].start.mock.calls[0][1]).toBeCloseTo(stopped + .05);
    expect(sources[5].start.mock.calls[0][1]).toBeCloseTo(stopped);
  });
  it('uses the common playable duration and ignores stale ended callbacks after a seek', () => {
    const { transport, sources } = fixture(); transport.play(); const ended = sources[0].onended;
    transport.seek(30); ended(); expect(transport.playing).toBe(true);
    sources[2].onended(); expect(transport.playing).toBe(false); expect(transport.position).toBe(160);
    transport.play(); expect(sources[4].start.mock.calls[0][1]).toBe(.05);
  });
});
