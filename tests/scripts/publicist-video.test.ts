import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// kit.js is a classic browser script; run it in a bare context and read VideoKit back.
const kit = (() => {
  const ctx: Record<string, any> = {};
  runInNewContext(readFileSync(resolve('scripts/publicist/video/kit.js'), 'utf8'), ctx);
  return ctx.VideoKit;
})();

describe('publicist video timeline', () => {
  const tl = kit.timeline([
    { id: 'a', build: 2 },
    { id: 'b', build: 3, lead: 0, hold: 2.5 },
  ]);

  it('gives each scene a headline lead, its build and a hold, back to back', () => {
    expect(tl.scenes.map((s: any) => [s.id, s.start, s.end])).toEqual([['a', 0, 4.6], ['b', 4.6, 10.1]]);
    expect(tl.total).toBeCloseTo(10.1);
  });

  it('holds build time at 0 during the lead and at the build end during the hold', () => {
    expect(tl.at(0.3)).toMatchObject({ id: 'a', local: 0 });
    expect(tl.at(1.6).local).toBeCloseTo(1);
    expect(tl.at(4.0)).toMatchObject({ id: 'a', local: 2 });
    expect(tl.at(5.6)).toMatchObject({ id: 'b', local: 1 });
  });

  it('stays on the last scene past the end', () => {
    expect(tl.at(99)).toMatchObject({ id: 'b', local: 3 });
  });

  it('defaults to a 0.6 s lead and a 2 s hold', () => {
    expect(kit.DEFAULTS).toEqual({ lead: 0.6, hold: 2 });
  });
});
