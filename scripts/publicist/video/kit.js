// Shared timing helpers for publicist videos (docs/publicist/video-standard.md).
// Loaded into a scene page by render.mjs; exposes window.VideoKit. A classic script,
// not a module, so it also runs from file:// pages.
(function (root) {
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const prog = (t, start, dur) => ease((t - start) / dur);

  // A scene plays in three parts: its headline alone (lead), the picture building
  // in reading order (build), then the finished frame held still (hold).
  const DEFAULTS = { lead: 0.6, hold: 2 };
  function timeline(plan) {
    let at = 0;
    const scenes = plan.map((s, index) => {
      const lead = s.lead ?? DEFAULTS.lead, hold = s.hold ?? DEFAULTS.hold;
      const o = { id: s.id, index, lead, build: s.build, hold, start: at, end: at + lead + s.build + hold };
      at = o.end;
      return o;
    });
    return {
      scenes,
      total: at,
      // local: seconds into the build (0 during the lead, the build's end during the hold)
      at(t) {
        const s = scenes.find((x) => t < x.end) || scenes[scenes.length - 1];
        const raw = t - s.start;
        return { ...s, raw, local: clamp(raw - s.lead, 0, s.build), progress: clamp(raw / (s.end - s.start)) };
      },
    };
  }

  // fade an element in from below; returns its progress
  function fade(el, t, start, dur = 0.4, dy = 30) {
    const p = prog(t, start, dur);
    el.style.opacity = p;
    el.style.transform = `translateY(${(1 - p) * dy}px)`;
    return p;
  }

  // Wire a video: plan + draw(sceneId, local, scene). Shows one .scene at a time,
  // adds a slow camera drift that restarts only at cuts, and exposes
  // window.render(t) and window.VIDEO for render.mjs.
  function run({ plan, draw, stage = document.getElementById('stage'), drift = 0.02 }) {
    const tl = timeline(plan);
    root.VIDEO = { plan: tl.scenes.map(({ id, lead, build, hold, start, end }) => ({ id, lead, build, hold, start, end })), total: tl.total };
    root.render = (t) => {
      const s = tl.at(t);
      for (const x of tl.scenes) { const el = document.getElementById(x.id); if (el) el.style.display = x.id === s.id ? 'block' : 'none'; }
      if (stage) stage.style.transform = `scale(${1 + drift * s.progress})`;
      draw(s.id, s.local, s);
    };
    root.render(0);
    return tl;
  }

  root.VideoKit = { clamp, ease, easeInOut, prog, fade, timeline, run, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
