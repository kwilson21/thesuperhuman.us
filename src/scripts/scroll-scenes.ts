// The site's motion layer. Pages mark elements and call runMotion(); every resting frame
// is in the HTML and CSS, so without this script, or with reduced motion, pages are
// complete and still. With motion it:
// - gives each [data-scene] its scroll progress as --p (data-start / data-end are
//   viewport fractions for the element's top edge; see sceneProgress),
// - reveals each [data-reveal] once (.is-in), at once if a keyboard user lands inside it,
// - plays a [data-play="ms"] element's .is-playing scene once when it reveals,
// - lets [data-tilt] elements lean toward a fine pointer (--rx, --ry).
// Anything that plays by itself must rest within five seconds (WCAG 2.2.2).
import { sceneProgress } from '~/lib/scroll-scenes';

export interface MotionContext {
  signal: AbortSignal;
  finePointer: boolean;
  /** Runs with each new progress of this [data-scene] element. */
  onScene(element: HTMLElement, hook: (progress: number) => void): void;
  /** Runs once when this element reveals; it joins the reveals even without [data-reveal]. */
  onReveal(element: Element, run: () => void): void;
  cleanup(fn: () => void): void;
}

/** Adds .is-playing for `ms`, then rests. Calling play() while it plays does nothing. */
export function scenePlayer(element: HTMLElement, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { clearTimeout(timer); timer = undefined; element.classList.remove('is-playing'); };
  const play = () => {
    if (timer) return;
    element.classList.remove('is-playing');
    void element.getBoundingClientRect();
    element.classList.add('is-playing');
    timer = setTimeout(stop, ms);
  };
  return { play, stop };
}

const motionQuery = matchMedia('(prefers-reduced-motion: no-preference)');
const root = document.documentElement;

function start(setup?: (context: MotionContext) => void): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const cleanups: (() => void)[] = [];
  const hooks = new Map<HTMLElement, (progress: number) => void>();
  const onRevealRuns = new Map<Element, (() => void)[]>();
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  setup?.({
    signal, finePointer,
    onScene: (element, hook) => hooks.set(element, hook),
    onReveal: (element, run) => onRevealRuns.set(element, [...(onRevealRuns.get(element) ?? []), run]),
    cleanup: fn => cleanups.push(fn),
  });

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

  const players = new Map<Element, ReturnType<typeof scenePlayer>>();
  document.querySelectorAll<HTMLElement>('[data-play]').forEach(element => players.set(element, scenePlayer(element, Number(element.dataset.play) || 4800)));
  cleanups.push(() => players.forEach(player => player.stop()));
  const reveals = [...new Set([...document.querySelectorAll<HTMLElement>('[data-reveal]'), ...onRevealRuns.keys()])] as HTMLElement[];
  const revealed = (element: Element) => {
    if (element.classList.contains('is-in')) return;
    element.classList.add('is-in');
    observer.unobserve(element);
    onRevealRuns.get(element)?.forEach(run => run());
    players.get(element)?.play();
  };
  const observer = new IntersectionObserver(entries => entries.forEach(entry => entry.isIntersecting && revealed(entry.target)),
    { rootMargin: '0px 0px -12% 0px' });
  // Anything on screen at first paint has been seen; only what is below the fold waits.
  reveals.forEach(element => {
    const box = element.getBoundingClientRect();
    if (box.top < innerHeight && box.bottom > 0) revealed(element);
    else observer.observe(element);
  });
  // A keyboard user can land inside a block before it scrolls into view; show it at once.
  document.addEventListener('focusin', event => {
    const block = reveals.find(element => element.contains(event.target as Node));
    if (!block) return;
    block.classList.add('is-instant');
    revealed(block);
    requestAnimationFrame(() => requestAnimationFrame(() => block.classList.remove('is-instant')));
  }, { signal });
  cleanups.push(() => {
    observer.disconnect();
    reveals.forEach(element => element.classList.remove('is-in', 'is-instant'));
  });

  if (finePointer) {
    document.querySelectorAll<HTMLElement>('[data-tilt]').forEach(card => {
      card.addEventListener('pointermove', event => {
        const box = card.getBoundingClientRect();
        card.style.setProperty('--rx', (((event.clientY - box.top) / box.height) * -2 + 1).toFixed(3));
        card.style.setProperty('--ry', (((event.clientX - box.left) / box.width) * 2 - 1).toFixed(3));
      }, { signal });
      card.addEventListener('pointerleave', () => { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); }, { signal });
    });
  }

  // Added last: if anything above throws, nothing is ever hidden.
  root.classList.add('motion');
  return () => {
    controller.abort();
    cleanups.forEach(cleanup => cleanup());
    root.classList.remove('motion');
  };
}

/** Starts the motion layer for this page, and stops or restarts it if reduced motion changes. */
export function runMotion(setup?: (context: MotionContext) => void) {
  let stop: (() => void) | undefined;
  let printed = false;
  const halt = () => { stop?.(); stop = undefined; };
  const sync = () => {
    if (motionQuery.matches && !stop && !printed) {
      try { stop = start(setup); }
      catch (error) { root.classList.remove('motion'); console.error(error); }
    } else if (!motionQuery.matches && stop) halt();
  };
  motionQuery.addEventListener('change', sync);
  // A printed or saved page gets every resting frame; motion stays off afterwards.
  addEventListener('beforeprint', () => { printed = true; halt(); });
  sync();
}
