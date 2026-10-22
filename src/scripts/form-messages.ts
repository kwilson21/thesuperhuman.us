/**
 * Form messages slide open (D9.2-D). `update` writes the messages, marks fields and moves focus as
 * before, and its result is returned. The text is in place at once, so live regions announce
 * without delay. Then each message that opened grows over 180ms on --ease-site and fades in, or
 * appears at once with reduced motion. If the form's primary action was on screen and the new
 * messages would push it below the fold, the page scrolls by just enough, in step with the opening
 * (at once with reduced motion), as long as the focused field stays in view. When focus itself
 * moved the page, focus wins.
 */
const MESSAGES = '[data-form-error], [data-form-status], [data-field-error], [data-signing-errors]';
const DURATION = 180;
// Room kept between the action and the fold, and above the focused field.
const GAP = 16;

type Before = { height: number; hidden: boolean; marginTop: string; marginBottom: string };

export function openMessages<T>(scope: Document | HTMLElement, action: HTMLElement | null | undefined, update: () => T): T {
  // Without a browser layout (unit tests use stand-in elements), only the update runs.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function' || typeof getComputedStyle !== 'function' || typeof Node === 'undefined' || !(scope instanceof Node)) {
    return update();
  }
  const before = new Map<HTMLElement, Before>();
  for (const node of scope.querySelectorAll<HTMLElement>(MESSAGES)) {
    const style = getComputedStyle(node), hidden = style.display === 'none';
    before.set(node, { height: node.getBoundingClientRect().height, hidden, marginTop: hidden ? '0px' : style.marginTop, marginBottom: hidden ? '0px' : style.marginBottom });
  }
  const actionBefore = onScreen(action), scrollBefore = window.scrollY;
  const result = update();
  const opened = [...scope.querySelectorAll<HTMLElement>(MESSAGES)].filter(node => !before.get(node)?.height && node.getBoundingClientRect().height > 0);
  const shift = actionBefore && window.scrollY === scrollBefore ? scrollNeeded(action!, actionBefore) : 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !opened.length || typeof opened[0].animate !== 'function') {
    if (shift) window.scrollBy({ top: shift, behavior: 'instant' });
    return result;
  }
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-site').trim() || 'ease-out';
  let grows = false;
  const animations = opened.map(node => {
    const style = getComputedStyle(node), was = before.get(node);
    if (style.display.startsWith('inline')) return node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing });
    grows = true;
    const fromHidden = !was || was.hidden;
    const end = {
      height: `${node.getBoundingClientRect().height}px`, marginTop: style.marginTop, marginBottom: style.marginBottom,
      paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, borderTopWidth: style.borderTopWidth, borderBottomWidth: style.borderBottomWidth,
    };
    const start = {
      height: '0px', marginTop: was?.marginTop ?? '0px', marginBottom: was?.marginBottom ?? '0px',
      paddingTop: fromHidden ? '0px' : end.paddingTop, paddingBottom: fromHidden ? '0px' : end.paddingBottom,
      borderTopWidth: fromHidden ? '0px' : end.borderTopWidth, borderBottomWidth: fromHidden ? '0px' : end.borderBottomWidth,
    };
    // Both frames use border-box with the measured height, so the last frame matches the layout exactly.
    return node.animate([{ ...start, opacity: 0, overflow: 'clip', boxSizing: 'border-box' }, { ...end, opacity: 1, overflow: 'clip', boxSizing: 'border-box' }], { duration: DURATION, easing });
  });
  if (!shift) return result;
  if (!grows) {
    window.scrollBy({ top: shift, behavior: 'instant' });
    return result;
  }
  // The page follows the opening frame by frame, so the action glides instead of dipping below the fold.
  const lead = animations[0], from = window.scrollY;
  const follow = () => {
    const done = lead.playState === 'finished' || lead.playState === 'idle';
    const progress = done ? 1 : lead.currentTime === null ? 0 : lead.effect?.getComputedTiming().progress ?? 1;
    window.scrollTo({ top: from + shift * progress, behavior: 'instant' });
    if (!done) requestAnimationFrame(follow);
  };
  follow();
  return result;
}

function onScreen(action: HTMLElement | null | undefined) {
  if (!action) return null;
  const rect = action.getBoundingClientRect();
  return rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight ? rect : null;
}

function scrollNeeded(action: HTMLElement, before: DOMRect) {
  const focused = document.activeElement;
  const focusTop = focused instanceof HTMLElement && focused !== document.body ? focused.getBoundingClientRect().top : undefined;
  return scrollShift(before.bottom, action.getBoundingClientRect().bottom, window.innerHeight, focusTop);
}

/**
 * How far to scroll so an action whose bottom moved from `before` to `after` (viewport pixels) stays
 * above the fold: at most GAP above it, or where it was if it already sat closer. Never so far that
 * the focused field's top leaves the screen.
 */
export function scrollShift(before: number, after: number, fold: number, focusTop?: number) {
  let shift = after - Math.max(before, fold - GAP);
  if (focusTop !== undefined) shift = Math.min(shift, focusTop - GAP);
  return Math.max(0, Math.round(shift));
}
