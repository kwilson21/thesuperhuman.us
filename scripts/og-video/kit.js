// Timing helpers for link-preview scenes. Loaded as a classic script, because module scripts do
// not load from file:// URLs. Every animation spans the whole loop (data-duration on <html>) and
// repeats forever, so the renderer can pause them all and step one shared clock.
//
//   play('.title', [[0, { opacity: 0 }], [400, { opacity: 1 }], [5600, { opacity: 1 }], [6000, { opacity: 0 }]]);
//
// Each step is [time in ms, keyframe]. A keyframe's `easing` shapes the move to the next step.
// Values hold before the first step and after the last one. Make the state at the end of the loop
// match the state at 0 ms: render.mjs refuses a scene whose loop jumps.
// `stagger` delays each further match by that many ms, keeping every step inside the loop.
(() => {
  const loop = Number(document.documentElement.dataset.duration);
  if (!Number.isFinite(loop) || loop <= 0) throw new Error('Set data-duration on <html> in milliseconds.');
  const ease = {
    out: 'cubic-bezier(.2, .7, .2, 1)',
    inOut: 'cubic-bezier(.45, .05, .3, 1)',
    in: 'cubic-bezier(.5, 0, .75, 0)',
    spring: 'cubic-bezier(.3, 1.5, .5, 1)',
  };

  function frames(steps, shift) {
    const sorted = steps.map(([time, frame]) => [Math.min(loop, Math.max(0, time + shift)), frame]).sort((a, b) => a[0] - b[0]);
    const result = sorted.map(([time, frame]) => ({ ...frame, offset: time / loop }));
    const { offset: firstOffset, easing: _firstEasing, ...first } = result[0];
    const { offset: lastOffset, easing: _lastEasing, ...last } = result[result.length - 1];
    if (firstOffset > 0) result.unshift({ ...first, offset: 0 });
    if (lastOffset < 1) result.push({ ...last, offset: 1 });
    return result;
  }

  function play(target, steps, { stagger = 0 } = {}) {
    const elements = typeof target === 'string' ? [...document.querySelectorAll(target)] : [].concat(target);
    if (!elements.length) throw new Error(`play(): nothing matches ${target}`);
    return elements.map((element, index) => element.animate(frames(steps, index * stagger), { duration: loop, iterations: Infinity, fill: 'both' }));
  }

  window.og = { loop, ease, play };
})();
