// Home's motion layer. Every scene's resting frame is in the HTML and CSS, so without
// this script, or with reduced motion, the page is complete and still. With motion it:
// plays the studio scene (and replays it when the visitor comes back to it), feeds each
// [data-scene] its scroll progress as --p, reveals [data-reveal] blocks once, counts
// the capacity figure up, and adds pointer depth on devices with a fine pointer.
import {
  barsPath, capacityCells, easeOutCubic, formatFigure, parseFigure, sceneProgress, signalFrame, waveformPeaks,
} from '~/lib/home-motion';

const motionQuery = matchMedia('(prefers-reduced-motion: no-preference)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const root = document.documentElement;

type SceneHook = (progress: number) => void;

function start(): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const cleanups: (() => void)[] = [];
  root.classList.add('motion');

  // Studio: the three short scenes run once on arrival and rest within five seconds (WCAG 2.2.2).
  // They play again when the visitor returns to the top or points at the studio; nothing loops.
  const studio = document.querySelector<HTMLElement>('[data-studio]');
  const scene = studio?.querySelector<HTMLElement>('[data-studio-scene]');
  if (studio && scene) {
    let playing = false;
    let restTimer: ReturnType<typeof setTimeout> | undefined;
    const play = () => {
      if (playing) return;
      playing = true;
      scene.classList.remove('is-playing');
      void scene.getBoundingClientRect();
      scene.classList.add('is-playing');
      restTimer = setTimeout(() => { scene.classList.remove('is-playing'); playing = false; }, 4800);
    };
    play();
    let away = false;
    const heroWatch = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) away = true;
      else if (away) { away = false; play(); }
    });
    heroWatch.observe(studio);
    cleanups.push(() => { heroWatch.disconnect(); clearTimeout(restTimer); scene.classList.remove('is-playing'); });

    if (finePointer.matches) {
      let frame = 0;
      let inside = false;
      studio.addEventListener('pointermove', event => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const box = scene.getBoundingClientRect();
          scene.style.setProperty('--mx', (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3));
          scene.style.setProperty('--my', (((event.clientY - box.top) / box.height) * 2 - 1).toFixed(3));
          const over = event.clientX > box.left + box.width * 0.3 && event.clientX < box.right && event.clientY > box.top && event.clientY < box.bottom;
          // Replays when the pointer arrives over the studio, not continuously while it stays.
          if (over && !inside) play();
          inside = over;
        });
      }, { signal });
      studio.addEventListener('pointerleave', () => { inside = false; scene.style.setProperty('--mx', '0'); scene.style.setProperty('--my', '0'); }, { signal });
      cleanups.push(() => { scene.style.removeProperty('--mx'); scene.style.removeProperty('--my'); });
    }
  }

  // Scenes: each gets --p from 0 to 1 as it crosses its start and end lines.
  const hooks = new Map<HTMLElement, SceneHook>();
  const signalEdge = document.querySelector<HTMLElement>('[data-scene="signal"]');
  if (signalEdge) {
    const bars = Number(signalEdge.dataset.bars);
    const width = Number(signalEdge.dataset.width);
    const mid = Number(signalEdge.dataset.mid);
    const peaks = waveformPeaks(bars);
    const up = signalEdge.querySelector('[data-signal="up"]');
    const down = signalEdge.querySelector('[data-signal="down"]');
    const rest = { up: up?.getAttribute('d') ?? '', down: down?.getAttribute('d') ?? '' };
    hooks.set(signalEdge, progress => {
      const heights = signalFrame(peaks, progress);
      up?.setAttribute('d', barsPath(heights, { width, mid, depth: mid, direction: 'up' }));
      down?.setAttribute('d', barsPath(heights, { width, mid, depth: mid, direction: 'down' }));
    });
    cleanups.push(() => { up?.setAttribute('d', rest.up); down?.setAttribute('d', rest.down); });
  }
  const scenes = [...document.querySelectorAll<HTMLElement>('[data-scene]')];
  const last = new Map<HTMLElement, number>();
  let pending = 0;
  const measure = () => {
    pending = 0;
    const viewport = innerHeight;
    const maxScroll = root.scrollHeight - viewport;
    const readings = scenes.map(element => {
      const top = element.getBoundingClientRect().top;
      return sceneProgress({
        top, viewport,
        start: Number(element.dataset.start ?? 1),
        end: Number(element.dataset.end ?? 0),
        topAtMaxScroll: top + scrollY - maxScroll,
      });
    });
    scenes.forEach((element, index) => {
      const progress = readings[index];
      if (Math.abs((last.get(element) ?? -1) - progress) < 0.0015) return;
      last.set(element, progress);
      element.style.setProperty('--p', progress.toFixed(4));
      hooks.get(element)?.(progress);
    });
  };
  const schedule = () => { pending ||= requestAnimationFrame(measure); };
  addEventListener('scroll', schedule, { passive: true, signal });
  addEventListener('resize', schedule, { signal });
  measure();
  cleanups.push(() => { cancelAnimationFrame(pending); scenes.forEach(element => element.style.removeProperty('--p')); });

  // Reveals: once in view, stay revealed. Anything already on screen shows at once.
  const counters = new Map<Element, () => void>();
  document.querySelectorAll<HTMLElement>('[data-count]').forEach(element => {
    const from = parseFigure(element.dataset.countFrom ?? '');
    const to = parseFigure(element.dataset.count ?? '');
    const display = element.querySelector<HTMLElement>('[data-count-display]');
    const cells = element.querySelector<HTMLElement>('[data-count-cells]');
    if (!from || !to || !display) return;
    const total = capacityCells(from, to);
    const run = () => {
      const began = performance.now();
      const tick = (now: number) => {
        const t = easeOutCubic((now - began) / 1600);
        const value = from.value + (to.value - from.value) * t;
        display.textContent = formatFigure(to, value);
        cells?.style.setProperty('--lit', String(Math.max(1, Math.round((value / to.value) * total))));
        if (t < 1) requestAnimationFrame(tick);
      };
      display.textContent = formatFigure(to, from.value);
      cells?.style.setProperty('--lit', '1');
      requestAnimationFrame(tick);
    };
    counters.set(element, run);
    cleanups.push(() => { display.textContent = formatFigure(to); cells?.style.removeProperty('--lit'); });
  });
  const reveals = [...document.querySelectorAll<HTMLElement>('[data-reveal], [data-count]')];
  const revealed = (element: Element) => { element.classList.add('is-in'); counters.get(element)?.(); observer.unobserve(element); };
  const observer = new IntersectionObserver(entries => entries.forEach(entry => entry.isIntersecting && revealed(entry.target)),
    { rootMargin: '0px 0px -12% 0px' });
  reveals.forEach(element => {
    const box = element.getBoundingClientRect();
    if (box.top < innerHeight * 0.88 && box.bottom > 0) revealed(element);
    else observer.observe(element);
  });
  // A keyboard user can land inside a block before it scrolls into view; show it at once.
  document.addEventListener('focusin', event => {
    const block = (event.target as Element).closest?.('[data-reveal]:not(.is-in), [data-count]:not(.is-in)');
    if (!block) return;
    (block as HTMLElement).style.transitionDuration = '0s';
    revealed(block);
  }, { signal });
  cleanups.push(() => { observer.disconnect(); reveals.forEach(element => { element.classList.remove('is-in'); element.style.removeProperty('transition-duration'); }); });

  // Depth: project screens lean toward a fine pointer.
  if (finePointer.matches) {
    document.querySelectorAll<HTMLElement>('[data-tilt]').forEach(card => {
      card.addEventListener('pointermove', event => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--rx', (((event.clientY - box.top) / box.height) * -2 + 1).toFixed(3));
        card.style.setProperty('--ry', (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3));
      }, { signal });
      card.addEventListener('pointerleave', () => { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }, { signal });
    });
  }

  return () => {
    controller.abort();
    cleanups.forEach(cleanup => cleanup());
    root.classList.remove('motion');
  };
}

let stop: (() => void) | undefined;
const sync = () => {
  if (motionQuery.matches && !stop) stop = start();
  else if (!motionQuery.matches && stop) { stop(); stop = undefined; }
};
motionQuery.addEventListener('change', sync);
sync();
